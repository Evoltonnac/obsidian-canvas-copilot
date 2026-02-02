/**
 * Mock SSE Data for debugging LLM stream processing.
 *
 * HOW TO USE:
 * 1. Capture SSE response from browser DevTools Network tab
 * 2. Paste the raw SSE data into MOCK_SSE_RAW_RESPONSE below
 * 3. Enable debug mode in Copilot settings (debug: true)
 * 4. Set MOCK_SSE_ENABLED to true
 * 5. Send a message in chat - it will use mock data instead of real API
 *
 * SSE FORMAT EXAMPLES:
 *
 * OpenAI/Anthropic style:
 * data: {"choices":[{"delta":{"content":"Hello"}}]}
 * data: {"choices":[{"delta":{"content":" world"}}]}
 * data: [DONE]
 *
 * LangChain chunk style (already parsed):
 * Just provide the content strings directly
 */

/**
 * Toggle to enable/disable mock SSE mode.
 * When true, all LLM requests will be intercepted and mock data will be used.
 */
export const MOCK_SSE_ENABLED = false;

/**
 * Delay between chunks in milliseconds.
 * Simulates network latency and streaming behavior.
 */
export const MOCK_CHUNK_DELAY_MS = 50;

/**
 * Raw SSE response captured from browser DevTools.
 * Paste your captured SSE data here.
 *
 * Supports multiple formats:
 * - Raw SSE lines (data: {...})
 * - Plain text chunks (one per line)
 * - JSON array of content strings
 */
export const MOCK_SSE_RAW_RESPONSE = `
// ===========================================
// PASTE YOUR CAPTURED SSE RESPONSE BELOW
// ===========================================
// Example 1: OpenAI-style SSE
// data: {"choices":[{"delta":{"content":"I'll help you"}}]}
// data: {"choices":[{"delta":{"content":" with that task."}}]}
// data: [DONE]
//
// Example 2: Plain text chunks (one per line)
// I'll help you
//  with that task.
//
// Example 3: Canvas operation example
// <canvas_edit canvas="test.canvas">
// <summary>Adding new nodes</summary>
// <add_node id="node1" type="text" x="100" y="100" width="200" height="100">
// <content>Hello World</content>
// </add_node>
// </canvas_edit>
// ===========================================
`.trim();

/**
 * Alternative: Pre-parsed content chunks for easier testing.
 * If this array is not empty, it will be used instead of MOCK_SSE_RAW_RESPONSE.
 */
export const MOCK_CONTENT_CHUNKS: string[] = [
  // Uncomment and modify these for quick testing:
  // "I'll help you ",
  // "analyze this. ",
  // "<use_tool>",
  // "<tool_name>localSearch</tool_name>",
  // "<parameters>",
  // "<query>test query</query>",
  // "</parameters>",
  // "</use_tool>",
  // "\n\nBased on my search...",
];

/**
 * Parse raw SSE response into content chunks.
 */
export function parseSSEToChunks(rawSSE: string): string[] {
  const lines = rawSSE.split("\n").filter((line) => line.trim());
  const chunks: string[] = [];

  for (const line of lines) {
    // Skip comments
    if (line.startsWith("//")) continue;

    // Handle SSE data: prefix
    if (line.startsWith("data: ")) {
      const data = line.slice(6).trim();

      // Skip [DONE] marker
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        // OpenAI format
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          chunks.push(content);
        }
        // Anthropic format
        const anthropicContent = parsed.delta?.text;
        if (anthropicContent) {
          chunks.push(anthropicContent);
        }
      } catch {
        // Not JSON, treat as plain text
        if (data && data !== "[DONE]") {
          chunks.push(data);
        }
      }
    } else {
      // Plain text line
      chunks.push(line);
    }
  }

  return chunks;
}

/**
 * Get the chunks to use for mock streaming.
 * Prefers MOCK_CONTENT_CHUNKS if not empty, otherwise parses MOCK_SSE_RAW_RESPONSE.
 */
export function getMockChunks(): string[] {
  if (MOCK_CONTENT_CHUNKS.length > 0) {
    return MOCK_CONTENT_CHUNKS;
  }
  return parseSSEToChunks(MOCK_SSE_RAW_RESPONSE);
}
