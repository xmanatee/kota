import * as fs from "fs";
import * as path from "path";

interface NotebookCell {
  type: "code" | "markdown";
  content: string;
}

interface ToolResult {
  content: string;
  is_error?: boolean;
}

function splitSource(content: string): string[] {
  if (!content) return [""];
  const lines = content.split("\n");
  return lines.map((line, i) => (i < lines.length - 1 ? line + "\n" : line));
}

function buildCell(cell: NotebookCell) {
  const base = {
    cell_type: cell.type,
    metadata: {},
    source: splitSource(cell.content),
  };
  return cell.type === "code"
    ? { ...base, outputs: [], execution_count: null }
    : base;
}

const KERNELS: Record<
  string,
  { name: string; display_name: string; language: string }
> = {
  python3: {
    name: "python3",
    display_name: "Python 3",
    language: "python",
  },
  javascript: {
    name: "javascript",
    display_name: "JavaScript",
    language: "javascript",
  },
};

function buildNotebook(cells: NotebookCell[], kernel = "python3") {
  const ks = KERNELS[kernel] ?? KERNELS.python3;
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        name: ks.name,
        display_name: ks.display_name,
        language: ks.language,
      },
      language_info: { name: ks.language },
    },
    cells: cells.map(buildCell),
  };
}

export const notebookTool = {
  name: "notebook",
  description:
    "Create or extend Jupyter notebooks (.ipynb). Use for shareable data analysis, tutorials, and documented explorations.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "add_cells"],
        description: "create: new notebook. add_cells: append to existing.",
      },
      path: {
        type: "string",
        description: "File path (must end with .ipynb).",
      },
      cells: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["code", "markdown"],
            },
            content: { type: "string" },
          },
          required: ["type", "content"],
        },
        description:
          'Cells to write. Each has type ("code"|"markdown") and content.',
      },
      kernel: {
        type: "string",
        enum: ["python3", "javascript"],
        description:
          "Kernel for code cells (default: python3). Only for create.",
      },
    },
    required: ["action", "path", "cells"],
  },
};

export async function runNotebook(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const action = input.action as string;
  const filePath = input.path as string;
  const cells = input.cells as NotebookCell[];
  const kernel = (input.kernel as string) ?? "python3";

  if (!filePath?.endsWith(".ipynb")) {
    return { content: "Error: path must end with .ipynb.", is_error: true };
  }
  if (!Array.isArray(cells) || cells.length === 0) {
    return { content: "Error: at least one cell is required.", is_error: true };
  }
  for (const c of cells) {
    if (!c.type || !["code", "markdown"].includes(c.type)) {
      return {
        content: `Error: cell type must be "code" or "markdown", got "${c.type}".`,
        is_error: true,
      };
    }
  }

  const resolved = path.resolve(filePath);

  if (action === "create") {
    await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
    const nb = buildNotebook(cells, kernel);
    await fs.promises.writeFile(resolved, JSON.stringify(nb, null, 2));
    return {
      content: `Created ${resolved} (${cells.length} cells, kernel: ${kernel})`,
    };
  }

  if (action === "add_cells") {
    let raw: string;
    try {
      raw = await fs.promises.readFile(resolved, "utf-8");
    } catch {
      return { content: `Error: file not found: ${resolved}`, is_error: true };
    }
    let nb: { cells: unknown[] };
    try {
      nb = JSON.parse(raw);
    } catch {
      return {
        content: `Error: invalid JSON in ${resolved}`,
        is_error: true,
      };
    }
    if (!Array.isArray(nb.cells)) {
      return {
        content: "Error: not a valid notebook (missing cells array).",
        is_error: true,
      };
    }
    nb.cells.push(...cells.map(buildCell));
    await fs.promises.writeFile(resolved, JSON.stringify(nb, null, 2));
    return {
      content: `Added ${cells.length} cells to ${resolved} (total: ${nb.cells.length})`,
    };
  }

  return {
    content: `Error: unknown action "${action}". Use "create" or "add_cells".`,
    is_error: true,
  };
}
