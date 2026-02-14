/**
 * MCP Tool Wrapper - Converts MCP tools to LangChain StructuredTool instances.
 *
 * Uses createLangChainTool to wrap MCP tools for use with bindTools().
 * Handles JSON Schema to Zod schema conversion and tool metadata mapping.
 */

import { createLangChainTool } from "@/tools/createLangChainTool";
import { z } from "zod";
import type { McpHttpClient, McpToolInfo } from "./McpHttpClient";
import { logError, logInfo } from "@/logger";
import { StructuredTool } from "@langchain/core/tools";

/**
 * Convert a JSON Schema property to a Zod schema type.
 */
function jsonSchemaPropertyToZod(prop: Record<string, unknown>, required: boolean): z.ZodTypeAny {
  const type = prop.type as string | undefined;
  const description = prop.description as string | undefined;

  let schema: z.ZodTypeAny;

  switch (type) {
    case "string": {
      let s = z.string();
      if (prop.enum && Array.isArray(prop.enum)) {
        // Create an enum-like union
        const values = prop.enum as string[];
        if (values.length > 0) {
          schema = z.enum(values as [string, ...string[]]);
          break;
        }
      }
      if (description) s = s.describe(description);
      schema = s;
      break;
    }
    case "number":
    case "integer": {
      let n = z.number();
      if (type === "integer") n = n.int();
      if (description) n = n.describe(description);
      schema = n;
      break;
    }
    case "boolean": {
      let b = z.boolean();
      if (description) b = b.describe(description);
      schema = b;
      break;
    }
    case "array": {
      const items = prop.items as Record<string, unknown> | undefined;
      if (items) {
        const itemSchema = jsonSchemaPropertyToZod(items, true);
        let arr = z.array(itemSchema);
        if (description) arr = arr.describe(description);
        schema = arr;
      } else {
        schema = z.array(z.any());
      }
      break;
    }
    case "object": {
      const properties = prop.properties as Record<string, Record<string, unknown>> | undefined;
      if (properties) {
        const requiredFields = (prop.required as string[]) ?? [];
        schema = jsonSchemaToZod({
          type: "object",
          properties,
          required: requiredFields,
        } as Record<string, unknown>);
      } else {
        schema = z.record(z.any());
      }
      if (description) schema = schema.describe(description);
      break;
    }
    default: {
      schema = z.any();
      if (description) schema = schema.describe(description);
      break;
    }
  }

  if (!required) {
    schema = schema.optional();
  }

  return schema;
}

/**
 * Convert a JSON Schema object to a Zod object schema.
 * Handles nested objects and arrays recursively.
 */
export function jsonSchemaToZod(jsonSchema: Record<string, unknown>): z.ZodObject<any> {
  const properties = jsonSchema.properties as Record<string, Record<string, unknown>> | undefined;
  const requiredFields = (jsonSchema.required as string[]) ?? [];

  if (!properties || Object.keys(properties).length === 0) {
    return z.object({});
  }

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, propSchema] of Object.entries(properties)) {
    const isRequired = requiredFields.includes(key);
    shape[key] = jsonSchemaPropertyToZod(propSchema, isRequired);
  }

  return z.object(shape);
}

/**
 * Create a LangChain StructuredTool from an MCP tool definition.
 *
 * @param serverId - The MCP server identifier
 * @param mcpTool - The MCP tool info from the server
 * @param client - The MCP HTTP client to use for calling the tool
 * @returns A LangChain StructuredTool compatible with bindTools()
 */
export function createMcpLangChainTool(
  serverId: string,
  mcpTool: McpToolInfo,
  client: McpHttpClient
): StructuredTool {
  // Use the first 8 characters of the serverId to keep the name short but unique enough
  const toolName = `mcp_${mcpTool.name}`;
  const zodSchema = jsonSchemaToZod(mcpTool.inputSchema);

  return createLangChainTool({
    name: toolName,
    description: mcpTool.description || `MCP tool: ${mcpTool.name}`,
    schema: zodSchema,
    func: async (args: Record<string, unknown>) => {
      try {
        logInfo(`[McpToolWrapper] Calling MCP tool: ${mcpTool.name} on server: ${serverId}`);
        const result = await client.callTool(mcpTool.name, args);

        if (result.isError) {
          const errorText = result.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n");
          return JSON.stringify({ error: errorText || "MCP tool returned an error" });
        }

        // Format result content
        const textContents = result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");

        if (textContents) {
          return textContents;
        }

        return JSON.stringify(result.content);
      } catch (error) {
        logError(`[McpToolWrapper] Error calling MCP tool ${mcpTool.name}:`, error);
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}
