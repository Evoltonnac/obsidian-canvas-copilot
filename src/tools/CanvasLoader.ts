import { TFile, Vault } from "obsidian";

/* ---------- Core data types ---------- */

interface CanvasNodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "file" | "text" | "link" | "group";
  label?: string; // groups
  color?: string; // files / links
  url?: string; // links
  file?: string; // files
  text?: string; // text cards
}

export interface RichNode extends CanvasNodeBase {
  /** Inlined markdown or plain‑text content (empty for groups/links). */
  content: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  /** Synthetic labels such as "contains". */
  label?: string;
}

export interface CanvasData {
  nodes: RichNode[];
  edges: CanvasEdge[];
  byId: Record<string, RichNode>;
}

/* ---------- Loader class ---------- */

export class CanvasLoader {
  constructor(private vault: Vault) {}

  /** Load & enrich a `.canvas` file. */
  async load(file: TFile): Promise<CanvasData> {
    const raw = await this.vault.read(file);
    const { nodes = [], edges = [] } = JSON.parse(raw) as {
      nodes: CanvasNodeBase[];
      edges: CanvasEdge[];
    };

    const richNodes: RichNode[] = await Promise.all(
      nodes.map(async (n) => {
        if (n.type === "file" && n.file) {
          const file = this.vault.getAbstractFileByPath(n.file);
          const md = file instanceof TFile ? await this.vault.cachedRead(file) : "";
          return { ...n, content: md };
        }
        if (n.type === "text") return { ...n, content: n.text ?? "" };
        return { ...n, content: "" }; // link / group
      })
    );

    const allEdges = [...edges];
    this.#deriveGroupEdges(richNodes, allEdges);

    const byId = Object.fromEntries(richNodes.map((n) => [n.id, n]));
    return { nodes: richNodes, edges: allEdges, byId };
  }

  /** Build a concise prompt for an LLM. */
  buildPrompt(canvas: CanvasData): string {
    const lines: string[] = [];
    lines.push(`Canvas contains ${canvas.nodes.length} nodes and ${canvas.edges.length} edges.\n`);

    lines.push("## Nodes\n");
    for (const node of canvas.nodes) {
      lines.push(`### Node: ${node.id} (${node.type})`);
      lines.push(`Position: (${node.x}, ${node.y}) Size: ${node.width}x${node.height}`);

      switch (node.type) {
        case "text":
          lines.push(`Content: ${node.text || ""}`);
          break;
        case "file":
          lines.push(`File: ${node.file || ""}`);
          if (node.content) {
            lines.push(`File Content:\n${node.content}`);
          }
          break;
        case "link":
          lines.push(`URL: ${node.url || ""}`);
          break;
        case "group":
          lines.push(`Label: ${node.label || "(no label)"}`);
          break;
      }
      lines.push("");
    }

    if (canvas.edges.length > 0) {
      lines.push("## Edges\n");
      for (const edge of canvas.edges) {
        const labelPart = edge.label ? ` "${edge.label}"` : "";
        lines.push(`- ${edge.fromNode} → ${edge.toNode}${labelPart}`);
      }
    }

    return lines.join("\n");
  }

  /* ---------- private helpers ---------- */

  /** Add synthetic 'contains' edges for group membership. */
  #deriveGroupEdges(nodes: RichNode[], edges: CanvasEdge[]) {
    const groups = nodes.filter((n) => n.type === "group");
    for (const g of groups) {
      for (const n of nodes) {
        if (n.id === g.id) continue;
        // Check if node's center point is within the group's bounds
        const nodeX = n.x + n.width / 2;
        const nodeY = n.y + n.height / 2;
        const inside =
          nodeX >= g.x && nodeY >= g.y && nodeX <= g.x + g.width && nodeY <= g.y + g.height;

        if (inside) {
          edges.push({
            id: crypto.randomUUID(),
            fromNode: g.id,
            toNode: n.id,
            label: "contains",
          });
        }
      }
    }
  }
}
