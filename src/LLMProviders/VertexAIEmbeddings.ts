import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import { logInfo, logError } from "@/logger";
import { VertexAIAuth } from "./VertexAIAuth";

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface VertexAIEmbeddingsParams extends EmbeddingsParams {
  /** Model name (e.g., text-embedding-004) */
  modelName: string;
  /** Service Account JSON as string (will be parsed internally) */
  serviceAccountKey: string;
  /** GCP project ID (optional, will use the one from service account if not provided) */
  projectId?: string;
  /** GCP region (default: us-central1) */
  region?: string;
  /** Fetch implementation */
  fetchImplementation?: FetchImplementation;
  /** Batch size for embedding requests */
  batchSize?: number;
  /** Timeout for requests */
  timeout?: number;
}

/**
 * Custom Embeddings for Google Vertex AI using Service Account JSON key authentication.
 * Uses shared VertexAIAuth for JWT signing and OAuth token management.
 */
export class VertexAIEmbeddings extends Embeddings {
  private readonly auth: VertexAIAuth;
  private readonly projectId: string;
  private readonly region: string;
  private readonly fetchImpl: FetchImplementation;
  private readonly batchSize: number;

  public readonly modelName: string;

  constructor(params: VertexAIEmbeddingsParams) {
    super(params);

    if (!params.modelName) {
      throw new Error("Vertex AI embedding model name is required.");
    }
    if (!params.serviceAccountKey) {
      throw new Error("Vertex AI service account key is required.");
    }

    // Initialize shared auth
    this.auth = new VertexAIAuth(params.serviceAccountKey, params.fetchImplementation);
    this.fetchImpl = this.auth.getFetch();

    this.modelName = params.modelName;
    this.projectId = params.projectId || this.auth.getProjectId();
    this.region = params.region || "us-central1";
    this.batchSize = params.batchSize || 250;
  }

  /**
   * Get the Vertex AI endpoint URL for embeddings.
   */
  private getEndpointUrl(streaming = false): string {
    const suffix = ":predict";
    // Check if modelName already includes the publishers prefix (for third-party models)
    const modelPath = this.modelName.startsWith("publishers/")
      ? this.modelName
      : `publishers/google/models/${this.modelName}`;
    return `https://aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/global/${modelPath}${suffix}`;
  }

  /**
   * Embed a single query string.
   */
  async embedQuery(text: string): Promise<number[]> {
    const embeddings = await this.embedDocuments([text]);
    return embeddings[0];
  }

  /**
   * Embed an array of documents.
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchResults = await this.embedBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Embed a batch of texts.
   */
  private async embedBatch(texts: string[]): Promise<number[][]> {
    const accessToken = await this.auth.getAccessToken();

    const instances = texts.map((text) => ({
      content: text,
    }));

    const requestBody = {
      instances,
    };

    logInfo(`Vertex AI embedding request for ${texts.length} texts`);

    const response = await this.fetchImpl(this.getEndpointUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError(`Vertex AI embedding request failed: ${response.status} - ${errorText}`);
      throw new Error(
        `Vertex AI embedding request failed with status ${response.status}: ${errorText}`
      );
    }

    const data = await response.json();

    // Extract embeddings from response
    const predictions = data.predictions as Array<{ embeddings: { values: number[] } }>;
    if (!predictions || predictions.length === 0) {
      throw new Error("No predictions returned from Vertex AI");
    }

    return predictions.map((prediction) => prediction.embeddings.values);
  }
}
