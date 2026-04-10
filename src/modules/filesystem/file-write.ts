import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { trackFileChange } from "../../core/loop/file-changes.js";
import type { ToolResult } from "../../core/tools/tool-result.js";
import { recordModification } from "../../file-tracker.js";
import { lintFile } from "../../lint.js";
import { printWriteSummary } from "./diff.js";

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
  if (existed) {
    try {
      if (statSync(path).isDirectory()) {
        return { content: `Error: ${path} is a directory, not a file`, is_error: true };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error: failed to inspect ${path}: ${message}`, is_error: true };
    }
  }
  const previousContent = existed ? readFileSync(path, "utf-8") : null;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");

  // Linter-gated: syntax check after write, revert on failure
  const lintResult = lintFile(path);
  if (!lintResult.ok) {
    if (previousContent !== null) {
      writeFileSync(path, previousContent, "utf-8"); // restore original
      recordModification(path);
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

  recordModification(path);
  trackFileChange(path, previousContent, "file_write");
  const lines = content.split("\n").length;
  if (existed && previousContent !== null) {
    printWriteSummary(path, previousContent.split("\n").length, lines);
  }
  return { content: `Wrote ${lines} lines to ${path}` };
}

export const registration = {
  tool: fileWriteTool,
  runner: runFileWrite,
  risk: "moderate" as const,
  kind: "action" as const,
};
