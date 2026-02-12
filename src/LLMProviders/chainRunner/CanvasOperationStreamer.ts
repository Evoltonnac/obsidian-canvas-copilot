/**
 * Canvas operation types and streaming parser for the Canvas Agent.
 * Implements the Streaming Diff/Apply pattern for efficient multi-operation execution.
 *
 * Protocol uses attribute-style XML for efficiency:
 * - <canvas_edit path="..." summary="...">
 * - <add_node id="..." type="text" x="0" y="0" width="200" height="100">content</add_node>
 * - <add_node id="..." type="file" file="..." x="0" y="0" width="200" height="100"/>
 * - <update_node id="..." x="100" content="..."/>
 * - <delete_node id="..."/>
 * - <add_edge id="..." from="..." to="..." fromSide="right" toSide="left"/>
 * - <delete_edge id="..."/>
 */

import type { NodeSide } from "obsidian/canvas";

/* ---------- Operation Types ---------- */

export type CanvasOperationType =
  | "add_node"
  | "update_node"
  | "delete_node"
  | "add_edge"
  | "delete_edge";

export interface BaseCanvasOperation {
  type: CanvasOperationType;
  id: string;
}

export interface AddNodeOperation extends BaseCanvasOperation {
  type: "add_node";
  nodeType: "text" | "file" | "link" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string; // for text nodes
  file?: string; // for file nodes
  url?: string; // for link nodes
  label?: string; // for group nodes
  color?: string;
}

export interface UpdateNodeOperation extends BaseCanvasOperation {
  type: "update_node";
  updates: Partial<{
    x: number;
    y: number;
    width: number;
    height: number;
    content: string;
    color: string;
    label: string;
  }>;
}

export interface DeleteNodeOperation extends BaseCanvasOperation {
  type: "delete_node";
}

export interface AddEdgeOperation extends BaseCanvasOperation {
  type: "add_edge";
  fromNode: string;
  toNode: string;
  fromSide?: NodeSide;
  toSide?: NodeSide;
  label?: string;
  color?: string;
}

export interface DeleteEdgeOperation extends BaseCanvasOperation {
  type: "delete_edge";
}

export type CanvasOperation =
  | AddNodeOperation
  | UpdateNodeOperation
  | DeleteNodeOperation
  | AddEdgeOperation
  | DeleteEdgeOperation;

export interface CanvasEditBlock {
  canvasPath: string;
  summary: string;
  operations: CanvasOperation[];
}

/* ---------- Streaming Parser ---------- */

/**
 * Streaming parser for canvas operations from LLM output.
 * Extracts completed operations incrementally for immediate execution.
 * Uses attribute-style XML protocol for token efficiency and parsing reliability.
 */
export class CanvasOperationStreamer {
  private buffer = "";
  private currentCanvasPath: string | null = null;
  private summary = "";

  /**
   * Process a chunk of LLM output and yield completed operations.
   */
  async *processChunk(chunk: string): AsyncGenerator<CanvasOperation> {
    this.buffer += chunk;

    // Extract canvas path and summary from attributes if not yet found
    // Format: <canvas_edit path="..." summary="...">
    if (!this.currentCanvasPath || !this.summary) {
      const canvasEditMatch = this.buffer.match(
        /<canvas_edit\s+path="([^"]+)"(?:\s+summary="([^"]*)")?/
      );
      if (canvasEditMatch) {
        if (!this.currentCanvasPath) {
          this.currentCanvasPath = canvasEditMatch[1];
        }
        if (!this.summary && canvasEditMatch[2]) {
          this.summary = canvasEditMatch[2];
        }
      }
    }

    // Extract and yield completed operations
    const completedOps = this.extractCompletedOperations();
    for (const op of completedOps) {
      yield op;
    }
  }

  /**
   * Get the canvas path from the edit block.
   */
  getCanvasPath(): string | null {
    return this.currentCanvasPath;
  }

  /**
   * Get the summary from the edit block.
   */
  getSummary(): string {
    return this.summary;
  }

  /**
   * Reset the streamer for a new stream.
   */
  reset(): void {
    this.buffer = "";
    this.currentCanvasPath = null;
    this.summary = "";
  }

  /**
   * Helper to parse all attributes from a tag string into a key-value map.
   */
  private parseAttributes(tagContent: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const attrPattern = /(\w+)="([^"]*)"/g;
    let match;
    while ((match = attrPattern.exec(tagContent)) !== null) {
      attrs[match[1]] = match[2];
    }
    return attrs;
  }

  /**
   * Extract completed operations from buffer and remove them.
   */
  private extractCompletedOperations(): CanvasOperation[] {
    const operations: CanvasOperation[] = [];

    // Pattern for add_node with inner content (text nodes)
    // <add_node id="..." type="text" x="0" y="0" width="200" height="100">content</add_node>
    const addNodeWithContentPattern =
      /<add_node\s+([^>]+)>([^<]*(?:<(?!\/add_node>)[^<]*)*)<\/add_node>/g;

    // Pattern for self-closing add_node (file, link, group nodes)
    // <add_node id="..." type="file" file="..." x="0" y="0" width="200" height="100"/>
    const addNodeSelfClosingPattern = /<add_node\s+([^/]+)\/>/g;

    // Pattern for update_node (attribute-style, self-closing)
    // <update_node id="..." x="100" content="..."/>
    const updateNodePattern = /<update_node\s+([^/]+)\/>/g;

    // Pattern for delete_node (self-closing)
    // <delete_node id="..."/>
    const deleteNodePattern = /<delete_node\s+([^/]+)\/>/g;

    // Pattern for add_edge (attribute-style, self-closing)
    // <add_edge id="..." from="..." to="..." fromSide="right" toSide="left" label="..."/>
    const addEdgePattern = /<add_edge\s+([^/]+)\/>/g;

    // Pattern for delete_edge (self-closing)
    // <delete_edge id="..."/>
    const deleteEdgePattern = /<delete_edge\s+([^/]+)\/>/g;

    let match;

    // Process add_node with content (text nodes)
    while ((match = addNodeWithContentPattern.exec(this.buffer)) !== null) {
      const attrs = this.parseAttributes(match[1]);
      const innerContent = match[2].trim();

      if (attrs.id && attrs.type) {
        operations.push({
          type: "add_node",
          id: attrs.id,
          nodeType: attrs.type as "text" | "file" | "link" | "group",
          x: parseInt(attrs.x || "0", 10),
          y: parseInt(attrs.y || "0", 10),
          width: parseInt(attrs.width || "200", 10),
          height: parseInt(attrs.height || "100", 10),
          color: attrs.color || undefined,
          content: innerContent || undefined,
          file: attrs.file || undefined,
          url: attrs.url || undefined,
          label: attrs.label || undefined,
        });
        this.buffer = this.buffer.replace(match[0], "");
        addNodeWithContentPattern.lastIndex = 0;
      }
    }

    // Process self-closing add_node (file, link, group nodes)
    while ((match = addNodeSelfClosingPattern.exec(this.buffer)) !== null) {
      const attrs = this.parseAttributes(match[1]);

      if (attrs.id && attrs.type) {
        operations.push({
          type: "add_node",
          id: attrs.id,
          nodeType: attrs.type as "text" | "file" | "link" | "group",
          x: parseInt(attrs.x || "0", 10),
          y: parseInt(attrs.y || "0", 10),
          width: parseInt(attrs.width || "200", 10),
          height: parseInt(attrs.height || "100", 10),
          color: attrs.color || undefined,
          file: attrs.file || undefined,
          url: attrs.url || undefined,
          label: attrs.label || undefined,
        });
        this.buffer = this.buffer.replace(match[0], "");
        addNodeSelfClosingPattern.lastIndex = 0;
      }
    }

    // Process update_node (attribute-style)
    while ((match = updateNodePattern.exec(this.buffer)) !== null) {
      const attrs = this.parseAttributes(match[1]);

      if (attrs.id) {
        const updates: UpdateNodeOperation["updates"] = {};
        if (attrs.x !== undefined) updates.x = parseInt(attrs.x, 10);
        if (attrs.y !== undefined) updates.y = parseInt(attrs.y, 10);
        if (attrs.width !== undefined) updates.width = parseInt(attrs.width, 10);
        if (attrs.height !== undefined) updates.height = parseInt(attrs.height, 10);
        if (attrs.content !== undefined) updates.content = attrs.content;
        if (attrs.color !== undefined) updates.color = attrs.color;
        if (attrs.label !== undefined) updates.label = attrs.label;

        operations.push({
          type: "update_node",
          id: attrs.id,
          updates,
        });
        this.buffer = this.buffer.replace(match[0], "");
        updateNodePattern.lastIndex = 0;
      }
    }

    // Process delete_node
    while ((match = deleteNodePattern.exec(this.buffer)) !== null) {
      const attrs = this.parseAttributes(match[1]);
      if (attrs.id) {
        operations.push({
          type: "delete_node",
          id: attrs.id,
        });
        this.buffer = this.buffer.replace(match[0], "");
        deleteNodePattern.lastIndex = 0;
      }
    }

    // Process add_edge (attribute-style)
    while ((match = addEdgePattern.exec(this.buffer)) !== null) {
      const attrs = this.parseAttributes(match[1]);

      if (attrs.from && attrs.to) {
        operations.push({
          type: "add_edge",
          id: attrs.id || `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          fromNode: attrs.from,
          toNode: attrs.to,
          fromSide: (attrs.fromSide as NodeSide) || undefined,
          toSide: (attrs.toSide as NodeSide) || undefined,
          label: attrs.label || undefined,
          color: attrs.color || undefined,
        });
        this.buffer = this.buffer.replace(match[0], "");
        addEdgePattern.lastIndex = 0;
      }
    }

    // Process delete_edge
    while ((match = deleteEdgePattern.exec(this.buffer)) !== null) {
      const attrs = this.parseAttributes(match[1]);
      if (attrs.id) {
        operations.push({
          type: "delete_edge",
          id: attrs.id,
        });
        this.buffer = this.buffer.replace(match[0], "");
        deleteEdgePattern.lastIndex = 0;
      }
    }

    return operations;
  }
}

/* ---------- Utility Functions ---------- */

/**
 * Check if a string contains a canvas_edit block.
 */
export function containsCanvasEdit(text: string): boolean {
  return text.includes("<canvas_edit");
}

/**
 * Extract the canvas path from a canvas_edit block.
 * Supports attribute-style: <canvas_edit path="...">
 */
export function extractCanvasPath(text: string): string | null {
  const match = text.match(/<canvas_edit\s+path="([^"]+)"/);
  return match ? match[1] : null;
}
