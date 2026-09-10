import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { recordModification } from "#core/file-tracking/file-tracker.js";
import { trackFileChange } from "#core/loop/file-changes.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import {
  isMachineAuthorityMutationPath,
  machineAuthorityMutationError,
} from "#core/tools/protected-scope-paths.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { printWriteSummary } from "./diff.js";
import { resolveToolPath } from "./path-resolver.js";

export const fileWriteTool: KotaTool = {
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
  context?: ToolRunnerContext,
): Promise<ToolResult> {
  const rawPath = input.path as string;
  const content = input.content as string;

  if (!rawPath) {
    return { content: "Error: path is required", is_error: true };
  }
  if (content === undefined || content === null) {
    return { content: "Error: content is required", is_error: true };
  }

  const path = resolveToolPath(rawPath, context);
  if (isMachineAuthorityMutationPath(path, context)) {
    return { content: machineAuthorityMutationError(), is_error: true };
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

  recordModification(path);
  trackFileChange(path, previousContent, "file_write");
  const lines = content.split("\n").length;
  if (existed && previousContent !== null) {
    printWriteSummary(path, previousContent.split("\n").length, lines);
  }
  return { content: `Wrote ${lines} lines to ${path}` };
}
