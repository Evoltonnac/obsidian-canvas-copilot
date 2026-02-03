import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
} from "@langchain/core/language_models/chat_models";
import { logInfo, logWarn, logError } from "@/logger";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import type { BaseMessage, UsageMetadata } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import type { ChatGeneration, ChatResult } from "@langchain/core/outputs";
import { VertexAIAuth } from "./VertexAIAuth";

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface VertexAIChatModelCallOptions extends BaseChatModelCallOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface VertexAIChatModelFields extends BaseChatModelParams {
  modelId: string;
  modelName?: string;
  /** Service Account JSON as string (will be parsed internally) */
  serviceAccountKey: string;
  /** GCP project ID (optional, will use the one from service account if not provided) */
  projectId?: string;
  /** GCP region (default: us-central1) */
  region?: string;
  defaultMaxTokens?: number;
  defaultTemperature?: number;
  defaultTopP?: number;
  fetchImplementation?: FetchImplementation;
  streaming?: boolean;
}

/**
 * Custom ChatModel for Google Vertex AI using Service Account JSON key authentication.
 * Uses shared VertexAIAuth for JWT signing and OAuth token management.
 */
export class VertexAIChatModel extends BaseChatModel<VertexAIChatModelCallOptions> {
  private readonly auth: VertexAIAuth;
  private readonly projectId: string;
  private readonly region: string;
  private readonly fetchImpl: FetchImplementation;
  private readonly defaultMaxTokens?: number;
  private readonly defaultTemperature?: number;
  private readonly defaultTopP?: number;
  private readonly streamingEnabled: boolean;

  // Public modelName property for LangChain capability detection
  public readonly modelName: string;

  constructor(fields: VertexAIChatModelFields) {
    const {
      modelId,
      serviceAccountKey,
      projectId,
      region,
      defaultMaxTokens,
      defaultTemperature,
      defaultTopP,
      fetchImplementation,
      streaming,
      ...baseParams
    } = fields;

    if (!modelId) {
      throw new Error("Vertex AI model identifier is required.");
    }
    if (!serviceAccountKey) {
      throw new Error("Vertex AI service account key is required.");
    }

    super(baseParams);

    // Initialize shared auth
    this.auth = new VertexAIAuth(serviceAccountKey, fetchImplementation);
    this.fetchImpl = this.auth.getFetch();

    this.modelName = modelId;
    this.projectId = projectId || this.auth.getProjectId();
    this.region = region || "us-central1";
    this.defaultMaxTokens = defaultMaxTokens;
    this.defaultTemperature = defaultTemperature;
    this.defaultTopP = defaultTopP;
    this.streamingEnabled = streaming ?? true;
  }

  _llmType(): string {
    return "google-vertexai";
  }

  /**
   * Get the Vertex AI endpoint URL for the model.
   * Handles third-party models that include their own publishers prefix (e.g., publishers/qwen/models/qwen3-embedding).
   */
  private getEndpointUrl(streaming = false): string {
    const suffix = streaming ? ":streamGenerateContent?alt=sse" : ":generateContent";
    // Check if modelName already includes the publishers prefix (for third-party models)
    const modelPath = this.modelName.startsWith("publishers/")
      ? this.modelName
      : `publishers/google/models/${this.modelName}`;
    return `https://aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/global/${modelPath}${suffix}`;
  }

  /**
   * Build the request body for Vertex AI Gemini models.
   */
  private buildRequestBody(
    messages: BaseMessage[],
    options?: VertexAIChatModelCallOptions
  ): Record<string, unknown> {
    const contents = this.convertMessagesToContents(messages);

    const generationConfig: Record<string, unknown> = {};

    const maxTokens = options?.maxTokens ?? this.defaultMaxTokens;
    if (maxTokens !== undefined) {
      generationConfig.maxOutputTokens = maxTokens;
    }

    const temperature = options?.temperature ?? this.defaultTemperature;
    if (temperature !== undefined) {
      generationConfig.temperature = temperature;
    }

    const topP = options?.topP ?? this.defaultTopP;
    if (topP !== undefined) {
      generationConfig.topP = topP;
    }

    return {
      contents,
      generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
    };
  }

  /**
   * Convert LangChain messages to Vertex AI content format.
   */
  private convertMessagesToContents(
    messages: BaseMessage[]
  ): Array<{ role: string; parts: Array<{ text: string }> }> {
    return messages.map((message) => {
      let role: string;
      const messageType = message._getType();

      if (messageType === "human") {
        role = "user";
      } else if (messageType === "ai") {
        role = "model";
      } else if (messageType === "system") {
        // Gemini doesn't have a system role - prepend to first user message
        // For now, treat as user
        role = "user";
      } else {
        role = "user";
      }

      const content =
        typeof message.content === "string" ? message.content : JSON.stringify(message.content);

      return {
        role,
        parts: [{ text: content }],
      };
    });
  }

  /**
   * Extract text from Vertex AI response.
   */
  private extractText(response: Record<string, unknown>): string {
    const candidates = response.candidates as Array<Record<string, unknown>> | undefined;
    if (!candidates || candidates.length === 0) {
      return "";
    }

    const content = candidates[0].content as Record<string, unknown> | undefined;
    if (!content) {
      return "";
    }

    const parts = content.parts as Array<Record<string, unknown>> | undefined;
    if (!parts || parts.length === 0) {
      return "";
    }

    return parts.map((part) => part.text || "").join("");
  }

  /**
   * Extract usage metadata from response.
   */
  private extractUsage(response: Record<string, unknown>): UsageMetadata | undefined {
    const usageMetadata = response.usageMetadata as Record<string, unknown> | undefined;
    if (!usageMetadata) {
      return undefined;
    }

    return {
      input_tokens: (usageMetadata.promptTokenCount as number) || 0,
      output_tokens: (usageMetadata.candidatesTokenCount as number) || 0,
      total_tokens: (usageMetadata.totalTokenCount as number) || 0,
    };
  }

  async _generate(
    messages: BaseMessage[],
    options?: VertexAIChatModelCallOptions,
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    const accessToken = await this.auth.getAccessToken();
    const requestBody = this.buildRequestBody(messages, options);

    const response = await this.fetchImpl(this.getEndpointUrl(false), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vertex AI request failed with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const text = this.extractText(data);

    if (runManager && text) {
      await runManager.handleLLMNewToken(text);
    }

    const usage = this.extractUsage(data);

    const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
    const finishReason = candidates?.[0]?.finishReason;

    const responseMetadata = {
      finishReason,
      usage,
      rawResponse: data,
    };

    const aiMessage = new AIMessage({
      content: text,
      response_metadata: responseMetadata,
      usage_metadata: usage,
    });

    const generation: ChatGeneration = {
      message: aiMessage,
      text,
      generationInfo: responseMetadata,
    };

    return {
      generations: [generation],
      llmOutput: responseMetadata,
    };
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: VertexAIChatModelCallOptions = {},
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    const accessToken = await this.auth.getAccessToken();
    const requestBody = this.buildRequestBody(messages, options);
    const requestId = `vertexai-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    logInfo(`[${requestId}] Starting Vertex AI stream request`);

    const response = await this.fetchImpl(this.getEndpointUrl(true), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Vertex AI streaming request failed with status ${response.status}: ${errorText}`
      );
    }

    if (!response.body) {
      throw new Error("Vertex AI streaming response did not include a readable body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") continue;

            try {
              const data = JSON.parse(jsonStr);
              const text = this.extractText(data);

              if (text) {
                const messageChunk = new AIMessageChunk({
                  content: text,
                  response_metadata: { provider: "google-vertexai" },
                });

                const generationChunk = new ChatGenerationChunk({
                  message: messageChunk,
                  text,
                  generationInfo: { provider: "google-vertexai" },
                });

                yield generationChunk;

                if (runManager) {
                  await runManager.handleLLMNewToken(text);
                }
              }
            } catch {
              logWarn(`[${requestId}] Failed to parse SSE data: ${jsonStr}`);
            }
          }
        }
      }
    } catch (error) {
      logError(
        `[${requestId}] Error during stream processing: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
}
