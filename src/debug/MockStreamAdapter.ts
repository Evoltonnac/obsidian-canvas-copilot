/**
 * Mock Stream Adapter for debugging LLM stream processing.
 *
 * This adapter creates a fake LLM stream from pre-defined mock data,
 * allowing you to debug and test stream processing logic without
 * making actual API calls.
 */

import { AIMessageChunk } from "@langchain/core/messages";
import { logInfo } from "@/logger";
import { MOCK_SSE_ENABLED, MOCK_CHUNK_DELAY_MS, getMockChunks } from "./mockSSEData";
import { getSettings } from "@/settings/model";

/**
 * Check if mock SSE mode should be active.
 * Requires both debug mode AND MOCK_SSE_ENABLED to be true.
 */
export function isMockSSEActive(): boolean {
  const settings = getSettings();
  return settings.debug && MOCK_SSE_ENABLED;
}

/**
 * Create a mock stream that yields AIMessageChunk objects.
 * Simulates the behavior of a real LLM streaming response.
 *
 * @param abortController - Optional abort controller to handle cancellation
 * @returns AsyncGenerator of AIMessageChunk
 */
export async function* createMockStream(
  abortController?: AbortController
): AsyncGenerator<AIMessageChunk> {
  const chunks = getMockChunks();

  if (chunks.length === 0) {
    logInfo("[MockSSE] No mock chunks configured. Check mockSSEData.ts");
    return;
  }

  logInfo(`[MockSSE] Starting mock stream with ${chunks.length} chunks`);

  for (let i = 0; i < chunks.length; i++) {
    // Check for abort signal
    if (abortController?.signal.aborted) {
      logInfo("[MockSSE] Stream aborted by user");
      break;
    }

    const content = chunks[i];

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, MOCK_CHUNK_DELAY_MS));

    // Create AIMessageChunk with the content
    const chunk = new AIMessageChunk({
      content: content,
      additional_kwargs: {},
    });

    logInfo(
      `[MockSSE] Chunk ${i + 1}/${chunks.length}: "${content.substring(0, 50)}${content.length > 50 ? "..." : ""}"`
    );

    yield chunk;
  }

  logInfo("[MockSSE] Mock stream completed");
}

/**
 * Utility function to test mock stream outside of the chat flow.
 * Useful for quick debugging in the console.
 *
 * Usage:
 *   import { testMockStream } from '@/debug/MockStreamAdapter';
 *   await testMockStream();
 */
export async function testMockStream(): Promise<string> {
  let fullContent = "";

  console.log("=== Mock Stream Test ===");

  for await (const chunk of createMockStream()) {
    const content =
      typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content);
    fullContent += content;
    console.log("Chunk:", content);
  }

  console.log("=== Full Content ===");
  console.log(fullContent);
  console.log("=== Test Complete ===");

  return fullContent;
}
