import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { checkFreshness, recordModification } from "#core/file-tracking/file-tracker.js";
import { trackFileChange } from "#core/loop/file-changes.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { lintFile } from "#root/lint.js";
import { fileNotFoundError } from "#root/path-resolver.js";
import { printEditDiff } from "./diff.js";
import {
  buildNotFoundMessage,
  tryWhitespaceMatch,
} from "./file-edit-helpers.js";

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
    return { content: fileNotFoundError(path), is_error: true };
  }
  try {
    if (statSync(path).isDirectory()) {
      return { content: `Error: ${path} is a directory, not a file`, is_error: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error: failed to inspect ${path}: ${message}`, is_error: true };
  }

  const staleWarning = checkFreshness(path);

  const content = readFileSync(path, "utf-8");
  const count = content.split(oldStr).length - 1;

  if (count === 0) {
    // Try whitespace-tolerant match before falling to fuzzy error
    const wsMatch = tryWhitespaceMatch(content, oldStr);
    if (wsMatch) {
      const updated = content.replace(wsMatch, () => newStr);
      writeFileSync(path, updated, "utf-8");

      const lintResult = lintFile(path);
      if (!lintResult.ok) {
        writeFileSync(path, content, "utf-8");
        recordModification(path);
        return {
          content:
            `Edit reverted — syntax error detected:\n${lintResult.error}\n\n` +
            `The file has been restored. Fix the syntax in your replacement and try again.`,
          is_error: true,
        };
      }

      recordModification(path);
      trackFileChange(path, content, "file_edit");
      const line = content.slice(0, content.indexOf(wsMatch)).split("\n").length;
      printEditDiff(path, content, wsMatch, newStr);
      return {
        content:
          `Applied with whitespace correction at line ${line} in ${path}. ` +
          `(Indentation/whitespace in old_string didn't match exactly, but content matched.)`,
      };
    }

    const msg = buildNotFoundMessage(path, content, oldStr);
    return {
      content: staleWarning ? `${staleWarning}\n\n${msg}` : msg,
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
    ? content.replaceAll(oldStr, () => newStr)
    : content.replace(oldStr, () => newStr);

  writeFileSync(path, updated, "utf-8");

  // Linter-gated: syntax check after edit, revert on failure
  const lintResult = lintFile(path);
  if (!lintResult.ok) {
    writeFileSync(path, content, "utf-8"); // revert
    recordModification(path);
    return {
      content:
        `Edit reverted — syntax error detected:\n${lintResult.error}\n\n` +
        `The file has been restored. Fix the syntax in your replacement and try again.`,
      is_error: true,
    };
  }

  recordModification(path);
  trackFileChange(path, content, "file_edit");
  const replacements = replaceAll ? count : 1;
  printEditDiff(path, content, oldStr, newStr);
  return { content: `Replaced ${replacements} occurrence(s) in ${path}` };
}

export const registration = {
  tool: fileEditTool,
  runner: runFileEdit,
  risk: "moderate" as const,
  kind: "action" as const,
};
