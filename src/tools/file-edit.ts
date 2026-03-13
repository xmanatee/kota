import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { ToolResult } from "./index.js";
import { lintFile } from "../lint.js";

export const fileEditTool: Anthropic.Tool = {
  name: "file_edit",
  description:
    "Edit a file by replacing an exact string with a new string. " +
    "The old_string must match exactly (including whitespace/indentation). " +
    "If old_string appears multiple times, set replace_all to true " +
    "or provide more context to make it unique. " +
    "This is the safest way to modify existing files.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Path to the file to edit",
      },
      old_string: {
        type: "string",
        description: "The exact string to find and replace",
      },
      new_string: {
        type: "string",
        description: "The replacement string",
      },
      replace_all: {
        type: "boolean",
        description: "Replace all occurrences (default: false)",
      },
    },
    required: ["path", "old_string", "new_string"],
  },
};

export async function runFileEdit(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const path = input.path as string;
  const oldStr = input.old_string as string;
  const newStr = input.new_string as string;
  const replaceAll = (input.replace_all as boolean) || false;

  if (!path) return { content: "Error: path is required", is_error: true };
  if (!oldStr) return { content: "Error: old_string is required", is_error: true };
  if (newStr === undefined) return { content: "Error: new_string is required", is_error: true };
  if (oldStr === newStr) return { content: "Error: old_string and new_string are identical", is_error: true };

  if (!existsSync(path)) {
    return { content: `Error: file not found: ${path}`, is_error: true };
  }

  const content = readFileSync(path, "utf-8");
  const count = content.split(oldStr).length - 1;

  if (count === 0) {
    // Help the agent debug: show what's near their intended edit
    const lines = content.split("\n");
    const preview = lines.slice(0, 20).join("\n");
    return {
      content:
        `Error: old_string not found in ${path}.\n` +
        `First 20 lines of the file:\n${preview}`,
      is_error: true,
    };
  }

  if (count > 1 && !replaceAll) {
    return {
      content:
        `Error: old_string appears ${count} times in ${path}. ` +
        `Provide more surrounding context to make it unique, ` +
        `or set replace_all to true.`,
      is_error: true,
    };
  }

  const updated = replaceAll
    ? content.replaceAll(oldStr, newStr)
    : content.replace(oldStr, newStr);

  writeFileSync(path, updated, "utf-8");

  // Linter-gated: syntax check after edit, revert on failure
  const lintResult = lintFile(path);
  if (!lintResult.ok) {
    writeFileSync(path, content, "utf-8"); // revert
    return {
      content:
        `Edit reverted — syntax error detected:\n${lintResult.error}\n\n` +
        `The file has been restored. Fix the syntax in your replacement and try again.`,
      is_error: true,
    };
  }

  const replacements = replaceAll ? count : 1;
  return { content: `Replaced ${replacements} occurrence(s) in ${path}` };
}
