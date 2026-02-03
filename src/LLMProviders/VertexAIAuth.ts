import { logError } from "@/logger";

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Google Cloud Service Account Key JSON structure.
 */
export interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
  universe_domain?: string;
}

interface CachedAccessToken {
  token: string;
  expiresAt: number;
}

/**
 * Shared authentication helper for Google Vertex AI.
 * Uses Web Crypto API to sign JWT for obtaining OAuth access tokens,
 * which can be used in browser environments like Obsidian.
 */
export class VertexAIAuth {
  private readonly serviceAccountKey: ServiceAccountKey;
  private readonly fetchImpl: FetchImplementation;

  // Static cache for access tokens, keyed by client_email
  // This allows token reuse across multiple VertexAIAuth instances
  private static tokenCache: Map<string, CachedAccessToken> = new Map();

  // Static cache for pending token requests to deduplicate concurrent requests
  private static pendingRequests: Map<string, Promise<string>> = new Map();

  /**
   * Create a new VertexAIAuth instance.
   * @param serviceAccountKeyJson - Service Account JSON as string
   * @param fetchImplementation - Optional fetch implementation
   */
  constructor(serviceAccountKeyJson: string, fetchImplementation?: FetchImplementation) {
    // Parse the service account key
    try {
      this.serviceAccountKey = JSON.parse(serviceAccountKeyJson);
    } catch {
      throw new Error("Invalid service account key JSON format.");
    }

    if (!this.serviceAccountKey.private_key || !this.serviceAccountKey.client_email) {
      throw new Error("Service account key must contain private_key and client_email.");
    }

    const globalFetch = typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined;
    this.fetchImpl = fetchImplementation ?? globalFetch;
    if (!this.fetchImpl) {
      throw new Error("No fetch implementation available for Vertex AI requests.");
    }
  }

  /**
   * Get the project ID from the service account key.
   */
  getProjectId(): string {
    return this.serviceAccountKey.project_id;
  }

  /**
   * Get the fetch implementation.
   */
  getFetch(): FetchImplementation {
    return this.fetchImpl;
  }

  /**
   * Convert a PEM-formatted private key to a CryptoKey for signing.
   */
  private async importPrivateKey(pem: string): Promise<CryptoKey> {
    const pemContents = pem
      .replace(/-----BEGIN PRIVATE KEY-----/g, "")
      .replace(/-----END PRIVATE KEY-----/g, "")
      .replace(/\s/g, "");

    const binaryDer = this.base64ToArrayBuffer(pemContents);

    return await crypto.subtle.importKey(
      "pkcs8",
      binaryDer,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      false,
      ["sign"]
    );
  }

  /**
   * Create a JWT signed with the service account private key.
   */
  private async createSignedJWT(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600; // 1 hour expiry

    const header = {
      alg: "RS256",
      typ: "JWT",
    };

    const payload = {
      iss: this.serviceAccountKey.client_email,
      sub: this.serviceAccountKey.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: expiry,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const signInput = `${encodedHeader}.${encodedPayload}`;

    const privateKey = await this.importPrivateKey(this.serviceAccountKey.private_key);
    const encoder = new TextEncoder();
    const signatureBuffer = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      encoder.encode(signInput)
    );

    const encodedSignature = this.arrayBufferToBase64Url(signatureBuffer);
    return `${signInput}.${encodedSignature}`;
  }

  /**
   * Exchange the signed JWT for an OAuth access token.
   * Tokens are cached and reused until they expire (with 5 min buffer).
   * Uses static cache keyed by client_email to share tokens across instances.
   * Concurrent requests are deduplicated by reusing pending promises.
   */
  async getAccessToken(): Promise<string> {
    const cacheKey = this.serviceAccountKey.client_email;
    const cachedToken = VertexAIAuth.tokenCache.get(cacheKey);

    // Check if we have a cached token that's still valid (with 5 min buffer)
    if (cachedToken && Date.now() < cachedToken.expiresAt - 300000) {
      return cachedToken.token;
    }

    // Check if there's already a pending request for this client_email
    const pendingRequest = VertexAIAuth.pendingRequests.get(cacheKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    // Create new token request and cache the promise
    const tokenPromise = this.fetchAccessToken(cacheKey);
    VertexAIAuth.pendingRequests.set(cacheKey, tokenPromise);

    try {
      return await tokenPromise;
    } finally {
      // Clean up pending request after completion (success or failure)
      VertexAIAuth.pendingRequests.delete(cacheKey);
    }
  }

  /**
   * Internal method to fetch a new access token from OAuth endpoint.
   */
  private async fetchAccessToken(cacheKey: string): Promise<string> {
    try {
      const jwt = await this.createSignedJWT();

      const response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to obtain access token: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const accessToken = data.access_token;
      const expiresIn = data.expires_in || 3600;

      // Cache the token using client_email as key
      VertexAIAuth.tokenCache.set(cacheKey, {
        token: accessToken,
        expiresAt: Date.now() + expiresIn * 1000,
      });

      return accessToken;
    } catch (error) {
      logError(`Failed to get Vertex AI access token: ${error}`);
      throw error;
    }
  }

  // Utility methods for base64 encoding/decoding

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private base64UrlEncode(str: string): string {
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  private arrayBufferToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
}

/**
 * Common configuration options for Vertex AI models.
 */
export interface VertexAIBaseConfig {
  serviceAccountKey: string;
  region: string;
  fetchImplementation?: FetchImplementation;
}

/**
 * Build base configuration for Vertex AI models.
 * This is a shared helper used by both chatModelManager and embeddingManager.
 *
 * @param serviceAccountKey - Decrypted service account JSON key
 * @param region - GCP region (e.g., us-central1)
 * @param enableCors - Whether to use CORS-enabled fetch
 * @param safeFetch - CORS-enabled fetch implementation
 */
export function buildVertexAIBaseConfig(
  serviceAccountKey: string,
  region: string,
  enableCors: boolean | undefined,
  safeFetch: FetchImplementation | undefined
): VertexAIBaseConfig {
  return {
    serviceAccountKey,
    region: region || "us-central1",
    fetchImplementation: enableCors ? safeFetch : undefined,
  };
}
