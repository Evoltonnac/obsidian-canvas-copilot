/**
 * Canvas manipulation tools for the Canvas Agent.
 * Implements atomic operations on canvas files following JSON-Canvas spec.
 */

import { TFile, Vault } from "obsidian";
import {
  AllCanvasNodeData,
  CanvasData,
  CanvasEdgeData,
  CanvasTextData,
  CanvasFileData,
  CanvasLinkData,
  CanvasGroupData,
} from "obsidian/canvas";
import { logError, logInfo } from "@/logger";
import {
  CanvasOperation,
  AddNodeOperation,
  UpdateNodeOperation,
  DeleteNodeOperation,
  AddEdgeOperation,
  DeleteEdgeOperation,
} from "@/LLMProviders/chainRunner/CanvasOperationStreamer";

/* ---------- Canvas I/O ---------- */

/**
 * Read and parse a canvas file.
 */
export async function readCanvasFile(vault: Vault, canvasPath: string): Promise<CanvasData | null> {
  try {
    const file = vault.getAbstractFileByPath(canvasPath);
    if (!(file instanceof TFile) || !file.path.endsWith(".canvas")) {
      logError(`[CanvasTools] Invalid canvas file: ${canvasPath}`);
      return null;
    }

    const content = await vault.read(file);
    return JSON.parse(content) as CanvasData;
  } catch (error) {
    logError(`[CanvasTools] Failed to read canvas: ${canvasPath}`, error);
    return null;
  }
}

/**
 * Write canvas data back to file.
 */
export async function writeCanvasFile(
  vault: Vault,
  canvasPath: string,
  data: CanvasData
): Promise<boolean> {
  try {
    const file = vault.getAbstractFileByPath(canvasPath);
    if (!(file instanceof TFile)) {
      logError(`[CanvasTools] Canvas file not found: ${canvasPath}`);
      return false;
    }

    const content = JSON.stringify(data, null, 2);
    await vault.modify(file, content);
    logInfo(`[CanvasTools] Canvas updated: ${canvasPath}`);
    return true;
  } catch (error) {
    logError(`[CanvasTools] Failed to write canvas: ${canvasPath}`, error);
    return false;
  }
}

/* ---------- Operation Execution ---------- */

export interface OperationResult {
  success: boolean;
  error?: string;
  affectedIds?: string[];
}

/**
 * Execute a single canvas operation.
 */
export async function executeCanvasOperation(
  vault: Vault,
  canvasPath: string,
  operation: CanvasOperation
): Promise<OperationResult> {
  const canvasData = await readCanvasFile(vault, canvasPath);
  if (!canvasData) {
    return { success: false, error: `Failed to read canvas: ${canvasPath}` };
  }

  let result: OperationResult;

  switch (operation.type) {
    case "add_node":
      result = executeAddNode(canvasData, operation);
      break;
    case "update_node":
      result = executeUpdateNode(canvasData, operation);
      break;
    case "delete_node":
      result = executeDeleteNode(canvasData, operation);
      break;
    case "add_edge":
      result = executeAddEdge(canvasData, operation);
      break;
    case "delete_edge":
      result = executeDeleteEdge(canvasData, operation);
      break;
    default:
      return { success: false, error: `Unknown operation type` };
  }

  if (result.success) {
    const writeSuccess = await writeCanvasFile(vault, canvasPath, canvasData);
    if (!writeSuccess) {
      return { success: false, error: "Failed to write canvas file" };
    }
  }

  return result;
}

/**
 * Execute multiple canvas operations atomically.
 */
export async function executeCanvasOperations(
  vault: Vault,
  canvasPath: string,
  operations: CanvasOperation[]
): Promise<{ results: OperationResult[]; allSuccess: boolean }> {
  const canvasData = await readCanvasFile(vault, canvasPath);
  if (!canvasData) {
    return {
      results: [{ success: false, error: `Failed to read canvas: ${canvasPath}` }],
      allSuccess: false,
    };
  }

  const results: OperationResult[] = [];

  for (const operation of operations) {
    let result: OperationResult;

    switch (operation.type) {
      case "add_node":
        result = executeAddNode(canvasData, operation);
        break;
      case "update_node":
        result = executeUpdateNode(canvasData, operation);
        break;
      case "delete_node":
        result = executeDeleteNode(canvasData, operation);
        break;
      case "add_edge":
        result = executeAddEdge(canvasData, operation);
        break;
      case "delete_edge":
        result = executeDeleteEdge(canvasData, operation);
        break;
      default:
        result = { success: false, error: `Unknown operation type` };
    }

    results.push(result);
  }

  const allSuccess = results.every((r) => r.success);

  // Only write if at least one operation succeeded
  if (results.some((r) => r.success)) {
    const writeSuccess = await writeCanvasFile(vault, canvasPath, canvasData);
    if (!writeSuccess) {
      return {
        results: results.map((r) =>
          r.success ? { ...r, success: false, error: "Failed to write canvas file" } : r
        ),
        allSuccess: false,
      };
    }
  }

  return { results, allSuccess };
}

/* ---------- Individual Operations ---------- */

function executeAddNode(canvasData: CanvasData, op: AddNodeOperation): OperationResult {
  // Check for duplicate ID
  if (canvasData.nodes.some((n) => n.id === op.id)) {
    return { success: false, error: `Node with ID "${op.id}" already exists` };
  }

  let newNode: AllCanvasNodeData;

  switch (op.nodeType) {
    case "text":
      newNode = {
        id: op.id,
        type: "text",
        x: op.x,
        y: op.y,
        width: op.width,
        height: op.height,
        text: op.content || "",
        color: op.color,
      } as CanvasTextData;
      break;

    case "file":
      if (!op.file) {
        return { success: false, error: "File path required for file node" };
      }
      newNode = {
        id: op.id,
        type: "file",
        x: op.x,
        y: op.y,
        width: op.width,
        height: op.height,
        file: op.file,
        color: op.color,
      } as CanvasFileData;
      break;

    case "link":
      if (!op.url) {
        return { success: false, error: "URL required for link node" };
      }
      newNode = {
        id: op.id,
        type: "link",
        x: op.x,
        y: op.y,
        width: op.width,
        height: op.height,
        url: op.url,
        color: op.color,
      } as CanvasLinkData;
      break;

    case "group":
      newNode = {
        id: op.id,
        type: "group",
        x: op.x,
        y: op.y,
        width: op.width,
        height: op.height,
        label: op.label,
        color: op.color,
      } as CanvasGroupData;
      break;

    default:
      return { success: false, error: `Unknown node type: ${op.nodeType}` };
  }

  canvasData.nodes.push(newNode);
  return { success: true, affectedIds: [op.id] };
}

function executeUpdateNode(canvasData: CanvasData, op: UpdateNodeOperation): OperationResult {
  const nodeIndex = canvasData.nodes.findIndex((n) => n.id === op.id);
  if (nodeIndex === -1) {
    return { success: false, error: `Node with ID "${op.id}" not found` };
  }

  const node = canvasData.nodes[nodeIndex];

  // Apply updates
  if (op.updates.x !== undefined) node.x = op.updates.x;
  if (op.updates.y !== undefined) node.y = op.updates.y;
  if (op.updates.width !== undefined) node.width = op.updates.width;
  if (op.updates.height !== undefined) node.height = op.updates.height;
  if (op.updates.color !== undefined) node.color = op.updates.color;

  // Type-specific updates
  if (node.type === "text" && op.updates.content !== undefined) {
    (node as CanvasTextData).text = op.updates.content;
  }
  if (node.type === "group" && op.updates.label !== undefined) {
    (node as CanvasGroupData).label = op.updates.label;
  }

  return { success: true, affectedIds: [op.id] };
}

function executeDeleteNode(canvasData: CanvasData, op: DeleteNodeOperation): OperationResult {
  const nodeIndex = canvasData.nodes.findIndex((n) => n.id === op.id);
  if (nodeIndex === -1) {
    return { success: false, error: `Node with ID "${op.id}" not found` };
  }

  // Remove the node
  canvasData.nodes.splice(nodeIndex, 1);

  // Remove all edges connected to this node
  const removedEdgeIds: string[] = [];
  canvasData.edges = canvasData.edges.filter((edge) => {
    if (edge.fromNode === op.id || edge.toNode === op.id) {
      removedEdgeIds.push(edge.id);
      return false;
    }
    return true;
  });

  return { success: true, affectedIds: [op.id, ...removedEdgeIds] };
}

function executeAddEdge(canvasData: CanvasData, op: AddEdgeOperation): OperationResult {
  // Validate nodes exist
  if (!canvasData.nodes.some((n) => n.id === op.fromNode)) {
    return { success: false, error: `Source node "${op.fromNode}" not found` };
  }
  if (!canvasData.nodes.some((n) => n.id === op.toNode)) {
    return { success: false, error: `Target node "${op.toNode}" not found` };
  }

  const newEdge: CanvasEdgeData = {
    id: op.id,
    fromNode: op.fromNode,
    toNode: op.toNode,
    fromSide: op.fromSide || "right",
    toSide: op.toSide || "left",
    label: op.label,
    color: op.color,
  };

  canvasData.edges.push(newEdge);
  return { success: true, affectedIds: [op.id] };
}

function executeDeleteEdge(canvasData: CanvasData, op: DeleteEdgeOperation): OperationResult {
  const edgeIndex = canvasData.edges.findIndex((e) => e.id === op.id);
  if (edgeIndex === -1) {
    return { success: false, error: `Edge with ID "${op.id}" not found` };
  }

  canvasData.edges.splice(edgeIndex, 1);
  return { success: true, affectedIds: [op.id] };
}
