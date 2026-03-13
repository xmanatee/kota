import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync, existsSync } from "node:fs";
import type { ToolResult } from "./index.js";
import { recordRead } from "../file-tracker.js";

export const fileReadTool: Anthropic.Tool = {
  name: "file_read",
  description:
    "Read the contents of a file with line numbers. " +
    "Supports offset and limit for reading portions of large files. " +
    "Returns numbered lines like 'cat -n'.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Path to the file (absolute or relative to cwd)",
      },
      offset: {
        type: "number",
        description: "Start reading from this line number (1-based, default: 1)",
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to return (default: 2000)",
      },
    },
    required: ["path"],
  },
};

export async function runFileRead(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const path = input.path as string;
  const offset = Math.max(1, (input.offset as number) || 1);
  const limit = (input.limit as number) || 2000;

  if (!path) {
    return { content: "Error: path is required", is_error: true };
  }

  if (!existsSync(path)) {
    return { content: `Error: file not found: ${path}`, is_error: true };
  }

  const raw = readFileSync(path, "utf-8");
  const lines = raw.split("\n");
  const selected = lines.slice(offset - 1, offset - 1 + limit);

  const numbered = selected
    .map((line, i) => {
      const lineNum = String(offset + i).padStart(6, " ");
      return `${lineNum}\t${line}`;
    })
    .join("\n");

  const info =
    lines.length > offset - 1 + limit
      ? `\n\n[Showing lines ${offset}-${offset + selected.length - 1} of ${lines.length} total]`
      : "";

  recordRead(path);
  return { content: numbered + info };
}
