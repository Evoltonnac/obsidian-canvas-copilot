import React from "react";
import {
  $getRoot,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
} from "lexical";
import { BasePillNode, SerializedBasePillNode } from "./BasePillNode";
import { TruncatedPillText } from "./TruncatedPillText";
import { PillBadge } from "./PillBadge";

export interface SerializedCanvasSelectionPillNode extends SerializedBasePillNode {
  canvasTitle: string;
  canvasPath: string;
  selectedNodeIds: string[];
}

/**
 * Lexical node for displaying canvas node selections in the chat input.
 * Similar to NotePillNode but stores multiple node IDs (non-contiguous selections).
 */
export class CanvasSelectionPillNode extends BasePillNode {
  __canvasTitle: string;
  __canvasPath: string;
  __selectedNodeIds: string[];

  static getType(): string {
    return "canvas-selection-pill";
  }

  static clone(node: CanvasSelectionPillNode): CanvasSelectionPillNode {
    return new CanvasSelectionPillNode(
      node.__canvasTitle,
      node.__canvasPath,
      node.__selectedNodeIds,
      node.__key
    );
  }

  constructor(canvasTitle: string, canvasPath: string, selectedNodeIds: string[], key?: NodeKey) {
    super(canvasTitle, key);
    this.__canvasTitle = canvasTitle;
    this.__canvasPath = canvasPath;
    this.__selectedNodeIds = selectedNodeIds;
  }

  getClassName(): string {
    return "canvas-selection-pill-wrapper";
  }

  getDataAttribute(): string {
    return "data-lexical-canvas-selection-pill";
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = "canvas-selection-pill-wrapper";
    return span;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        if (node.hasAttribute("data-lexical-canvas-selection-pill")) {
          return {
            conversion: convertCanvasSelectionPillElement,
            priority: 1,
          };
        }
        return null;
      },
    };
  }

  static importJSON(serializedNode: SerializedCanvasSelectionPillNode): CanvasSelectionPillNode {
    const { canvasTitle, canvasPath, selectedNodeIds } = serializedNode;
    return $createCanvasSelectionPillNode(canvasTitle, canvasPath, selectedNodeIds);
  }

  exportJSON(): SerializedCanvasSelectionPillNode {
    return {
      ...super.exportJSON(),
      canvasTitle: this.__canvasTitle,
      canvasPath: this.__canvasPath,
      selectedNodeIds: this.__selectedNodeIds,
      type: "canvas-selection-pill",
      version: 1,
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-lexical-canvas-selection-pill", "true");
    element.setAttribute("data-canvas-title", this.__canvasTitle);
    element.setAttribute("data-canvas-path", this.__canvasPath);
    element.setAttribute("data-selected-node-ids", JSON.stringify(this.__selectedNodeIds));
    const nodeCount = this.__selectedNodeIds.length;
    element.textContent = `[[${this.__canvasTitle}]] (${nodeCount} node${nodeCount !== 1 ? "s" : ""})`;
    return { element };
  }

  getTextContent(): string {
    const nodeCount = this.__selectedNodeIds.length;
    return `[[${this.__canvasTitle}]] (${nodeCount} node${nodeCount !== 1 ? "s" : ""})`;
  }

  getCanvasTitle(): string {
    return this.__canvasTitle;
  }

  getCanvasPath(): string {
    return this.__canvasPath;
  }

  getSelectedNodeIds(): string[] {
    return this.__selectedNodeIds;
  }

  decorate(): JSX.Element {
    return <CanvasSelectionPillComponent node={this} />;
  }
}

function convertCanvasSelectionPillElement(domNode: HTMLElement): DOMConversionOutput | null {
  const canvasTitle = domNode.getAttribute("data-canvas-title");
  const canvasPath = domNode.getAttribute("data-canvas-path");
  const nodeIdsStr = domNode.getAttribute("data-selected-node-ids");

  if (canvasTitle && canvasPath && nodeIdsStr) {
    try {
      const selectedNodeIds = JSON.parse(nodeIdsStr);
      const node = $createCanvasSelectionPillNode(canvasTitle, canvasPath, selectedNodeIds);
      return { node };
    } catch {
      return null;
    }
  }
  return null;
}

interface CanvasSelectionPillComponentProps {
  node: CanvasSelectionPillNode;
}

function CanvasSelectionPillComponent({ node }: CanvasSelectionPillComponentProps): JSX.Element {
  const canvasTitle = node.getCanvasTitle();
  const canvasPath = node.getCanvasPath();
  const selectedNodeIds = node.getSelectedNodeIds();
  const nodeCount = selectedNodeIds.length;

  const tooltipContent = (
    <div className="tw-text-left">
      <div>{canvasPath}</div>
      <div className="tw-mt-1 tw-text-xs tw-text-faint">
        Selected nodes: {selectedNodeIds.slice(0, 5).join(", ")}
        {nodeCount > 5 ? ` +${nodeCount - 5} more` : ""}
      </div>
    </div>
  );

  return (
    <PillBadge>
      <div className="tw-flex tw-items-center tw-gap-1">
        <TruncatedPillText
          content={canvasTitle}
          openBracket="[["
          closeBracket="]]"
          tooltipContent={tooltipContent}
        />
        <span className="tw-text-xs tw-text-faint">
          {nodeCount} node{nodeCount !== 1 ? "s" : ""}
        </span>
      </div>
    </PillBadge>
  );
}

// Utility functions
export function $createCanvasSelectionPillNode(
  canvasTitle: string,
  canvasPath: string,
  selectedNodeIds: string[]
): CanvasSelectionPillNode {
  return new CanvasSelectionPillNode(canvasTitle, canvasPath, selectedNodeIds);
}

export function $isCanvasSelectionPillNode(
  node: LexicalNode | null | undefined
): node is CanvasSelectionPillNode {
  return node instanceof CanvasSelectionPillNode;
}

export function $findCanvasSelectionPills(): CanvasSelectionPillNode[] {
  const root = $getRoot();
  const pills: CanvasSelectionPillNode[] = [];

  function traverse(node: LexicalNode) {
    if (node instanceof CanvasSelectionPillNode) {
      pills.push(node);
    }

    if ("getChildren" in node && typeof node.getChildren === "function") {
      const children = node.getChildren();
      for (const child of children) {
        traverse(child);
      }
    }
  }

  traverse(root);
  return pills;
}

export function $removeCanvasSelectionPillsByPath(canvasPath: string): number {
  const root = $getRoot();
  let removedCount = 0;

  function traverse(node: LexicalNode): void {
    if ($isCanvasSelectionPillNode(node) && node.getCanvasPath() === canvasPath) {
      node.remove();
      removedCount++;
    } else if ("getChildren" in node && typeof node.getChildren === "function") {
      const children = (node as any).getChildren();
      for (const child of children) {
        traverse(child);
      }
    }
  }

  traverse(root);
  return removedCount;
}
