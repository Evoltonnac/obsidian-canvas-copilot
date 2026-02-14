/**
 * MCP HTTP Client - Handles HTTP communication with MCP servers.
 *
 * Implements the MCP protocol over HTTP (Streamable HTTP transport),
 * supporting tool listing and tool calling with error handling and retry logic.
 *
 * Reference: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http
 */

import { requestUrl } from "obsidian";
import { getDecryptedKey } from "@/encryptionService";
import { logError, logInfo } from "@/logger";

/** MCP JSON-RPC request structure */
interface McpJsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/** MCP JSON-RPC response structure */
interface McpJsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** MCP Tool definition from server */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** MCP tool call result content item */
export interface McpToolResultContent {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
}

/** MCP tool call result */
export interface McpToolCallResult {
  content: McpToolResultContent[];
  isError?: boolean;
}

/** MCP server configuration */
export interface McpServerConfig {
  /** Unique identifier for this server */
  id: string;
  /** Display name */
  name: string;
  /** Server URL endpoint */
  url: string;
  /** Optional HTTP headers (may contain encrypted values) */
  headers?: Record<string, string>;
  /** Whether this server is enabled */
  enabled: boolean;
}

/** Options for McpHttpClient */
interface McpHttpClientOptions {
  /** Maximum number of retries for failed requests */
  maxRetries?: number;
  /** Timeout in milliseconds for each request */
  timeoutMs?: number;
  /** Base delay for exponential backoff in milliseconds */
  retryBaseDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<McpHttpClientOptions> = {
  maxRetries: 2,
  timeoutMs: 30000,
  retryBaseDelayMs: 1000,
};

export class McpHttpClient {
  private url: string;
  private headers: Record<string, string>;
  private options: Required<McpHttpClientOptions>;
  private requestIdCounter = 0;
  private sessionId: string | null = null;

  constructor(
    url: string,
    headers: Record<string, string> = {},
    options: McpHttpClientOptions = {}
  ) {
    this.url = url.replace(/\/$/, ""); // Remove trailing slash
    this.headers = headers;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Create an McpHttpClient from a server config, decrypting headers if needed.
   */
  static async fromConfig(
    config: McpServerConfig,
    options?: McpHttpClientOptions
  ): Promise<McpHttpClient> {
    const decryptedHeaders: Record<string, string> = {};
    if (config.headers) {
      for (const [key, value] of Object.entries(config.headers)) {
        decryptedHeaders[key] = await getDecryptedKey(value);
      }
    }
    return new McpHttpClient(config.url, decryptedHeaders, options);
  }

  /**
   * List available tools from the MCP server.
   */
  async listTools(): Promise<McpToolInfo[]> {
    const response = await this.sendRequest<{ tools: McpToolInfo[] }>("tools/list", {});
    return response.tools ?? [];
  }

  /**
   * Call a tool on the MCP server.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const response = await this.sendRequest<McpToolCallResult>("tools/call", {
      name: toolName,
      arguments: args,
    });
    return response;
  }

  /**
   * Initialize the MCP session (if server supports it).
   */
  async initialize(): Promise<void> {
    try {
      await this.sendRequest("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "obsidian-copilot-mcp-client",
          version: "1.0.0",
        },
      });

      // Send initialized notification
      await this.sendNotification("notifications/initialized", {});
      logInfo("[McpHttpClient] Session initialized successfully");
    } catch {
      // Initialization is optional - some servers don't require it
      logInfo("[McpHttpClient] Server may not require initialization, proceeding");
    }
  }

  /**
   * Send a JSON-RPC request with retry logic.
   */
  private async sendRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.options.retryBaseDelayMs * Math.pow(2, attempt - 1);
          await this.sleep(delay);
          logInfo(`[McpHttpClient] Retry attempt ${attempt} for ${method}`);
        }

        const result = await this.executeRequest<T>(method, params);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx)
        if (lastError.message.includes("HTTP 4")) {
          throw lastError;
        }

        logError(`[McpHttpClient] Request failed (attempt ${attempt + 1}):`, lastError);
      }
    }

    throw lastError ?? new Error(`Failed to execute MCP request: ${method}`);
  }

  /**
   * Execute a single JSON-RPC request.
   */
  private async executeRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const requestId = ++this.requestIdCounter;
    const body: McpJsonRpcRequest = {
      jsonrpc: "2.0",
      id: requestId,
      method,
      params,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...this.headers,
    };

    // Include session ID if we have one
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      // Use Obsidian's requestUrl to bypass CORS
      const response = await Promise.race([
        requestUrl({
          url: this.url,
          method: "POST",
          headers,
          body: JSON.stringify(body),
          throw: false, // Handle errors manually
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      ]);

      clearTimeout(timeoutId);

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}: ${response.text || response.status}`);
      }

      // Capture session ID from response headers
      const newSessionId = response.headers["mcp-session-id"];
      if (newSessionId) {
        this.sessionId = newSessionId;
      }

      const contentType = response.headers["content-type"] ?? "";

      // Handle SSE responses
      if (contentType.includes("text/event-stream")) {
        return this.parseSSEResponseText<T>(response.text, requestId);
      }

      // Handle JSON responses
      const jsonResponse = response.json as McpJsonRpcResponse;
      if (jsonResponse.error) {
        throw new Error(`MCP Error ${jsonResponse.error.code}: ${jsonResponse.error.message}`);
      }

      return jsonResponse.result as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`MCP request timed out after ${this.options.timeoutMs}ms`);
      }
      throw error;
    }
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  private async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
    const body = {
      jsonrpc: "2.0" as const,
      method,
      params,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.headers,
    };

    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    // Use Obsidian's requestUrl to bypass CORS
    await requestUrl({
      url: this.url,
      method: "POST",
      headers,
      body: JSON.stringify(body),
      throw: false,
    });
  }

  /**
   * Parse a Server-Sent Events response to extract JSON-RPC result.
   */
  private parseSSEResponseText<T>(text: string, requestId: number): T {
    const lines = text.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as McpJsonRpcResponse;
          if (parsed.id === requestId) {
            if (parsed.error) {
              throw new Error(`MCP Error ${parsed.error.code}: ${parsed.error.message}`);
            }
            return parsed.result as T;
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }

    throw new Error("No matching response found in SSE stream");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
