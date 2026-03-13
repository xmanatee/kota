import type Anthropic from "@anthropic-ai/sdk";
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolResult } from "./index.js";
import { lintFile } from "../lint.js";

export const fileWriteTool: Anthropic.Tool = {
  name: "file_write",
  description:
    "Create a new file or overwrite an existing file. " +
    "Parent directories are created automatically. " +
    "Use file_edit for modifying existing files (safer).",
  input_schema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Path to the file to create/overwrite",
      },
      content: {
        type: "string",
        description: "The full content to write to the file",
      },
    },
    required: ["path", "content"],
  },
};

export async function runFileWrite(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const path = input.path as string;
  const content = input.content as string;

  if (!path) {
    return { content: "Error: path is required", is_error: true };
  }
  if (content === undefined || content === null) {
    return { content: "Error: content is required", is_error: true };
  }

  const existed = existsSync(path);
  const previousContent = existed ? readFileSync(path, "utf-8") : null;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");

  // Linter-gated: syntax check after write, revert on failure
  const lintResult = lintFile(path);
  if (!lintResult.ok) {
    if (previousContent !== null) {
      writeFileSync(path, previousContent, "utf-8"); // restore original
    } else {
      unlinkSync(path); // remove newly created file
    }
    return {
      content:
        `Write reverted — syntax error detected:\n${lintResult.error}\n\n` +
        `The file has been restored. Fix the syntax and try again.`,
      is_error: true,
    };
  }

  const lines = content.split("\n").length;
  return { content: `Wrote ${lines} lines to ${path}` };
}
