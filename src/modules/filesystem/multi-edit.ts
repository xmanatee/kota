import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import { recordModification } from "#core/file-tracking/file-tracker.js";
import { trackFileChange } from "#core/loop/file-changes.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import {
  isMachineAuthorityMutationPath,
  machineAuthorityMutationError,
} from "#core/tools/protected-scope-paths.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { printEditDiff } from "./diff.js";
import { resolveToolPath } from "./path-resolver.js";

export const multiEditTool: KotaTool = {
  name: "multi_edit",
  description:
    "Apply related edits across one or more files. " +
    "Replacements are applied in order to prepare each file's final content before writing. " +
    "On write failure, restore attempted files and report any rollback failures.",
  input_schema: {
    type: "object" as const,
    properties: {
      edits: {
        type: "array",
        description: "Array of related edits to apply in order",
        items: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
            old_string: { type: "string", description: "Exact string to find" },
            new_string: { type: "string", description: "Replacement string" },
            replace_all: { type: "boolean", description: "Replace all occurrences" },
          },
          required: ["path", "old_string", "new_string"],
        },
      },
    },
    required: ["edits"],
  },
};

type EditEntry = {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
};

export async function runMultiEdit(
  input: Record<string, unknown>,
  context?: ToolRunnerContext,
): Promise<ToolResult> {
  const edits = input.edits as EditEntry[] | undefined;
  if (!edits || !Array.isArray(edits) || edits.length === 0) {
    return { content: "Error: edits array is required and must not be empty", is_error: true };
  }
  const resolvedEdits = edits.map((edit) => ({
    ...edit,
    path: edit.path ? resolveToolPath(edit.path, context) : edit.path,
  }));
  if (resolvedEdits.some((edit) =>
    edit.path && isMachineAuthorityMutationPath(edit.path, context)
  )) {
    return { content: machineAuthorityMutationError(), is_error: true };
  }

  const fileKeys = new Map<string, string>();
  // Validate every requested path before grouping aliases of the same file.
  for (let i = 0; i < resolvedEdits.length; i++) {
    const e = resolvedEdits[i];
    if (!e.path || !e.old_string || e.new_string === undefined) {
      return { content: `Error: edit[${i}] missing required fields`, is_error: true };
    }
    if (e.old_string === e.new_string) {
      return { content: `Error: edit[${i}] old_string and new_string are identical`, is_error: true };
    }
    if (!existsSync(e.path)) {
      return { content: `Error: edit[${i}] file not found: ${e.path}`, is_error: true };
    }
    try {
      const stat = statSync(e.path);
      if (stat.isDirectory()) {
        return { content: `Error: edit[${i}] ${e.path} is a directory, not a file`, is_error: true };
      }
      fileKeys.set(e.path, `${stat.dev}:${stat.ino}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error: edit[${i}] failed to inspect ${e.path}: ${message}`, is_error: true };
    }
  }

  const files = new Map<string, { path: string; original: string; updated: string }>();
  for (const e of resolvedEdits) {
    const key = fileKeys.get(e.path)!;
    if (!files.has(key)) {
      try {
        const original = readFileSync(e.path, "utf-8");
        files.set(key, { path: e.path, original, updated: original });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error: failed to read ${e.path}: ${message}. No files changed.`, is_error: true };
      }
    }
  }

  // Prepare every replacement before writing, including edits that depend on earlier ones.
  const diffs: Parameters<typeof printEditDiff>[] = [];
  for (let i = 0; i < resolvedEdits.length; i++) {
    const e = resolvedEdits[i];
    const file = files.get(fileKeys.get(e.path)!)!;
    const content = file.updated;
    const count = content.split(e.old_string).length - 1;

    if (count === 0) {
      return { content: `Error: edit[${i}] old_string not found in ${e.path}. No files changed.`, is_error: true };
    }

    if (count > 1 && !e.replace_all) {
      return {
        content: `Error: edit[${i}] old_string appears ${count} times in ${e.path}. ` +
          "Provide more context or set replace_all. No files changed.",
        is_error: true,
      };
    }

    file.updated = e.replace_all
      ? content.replaceAll(e.old_string, () => e.new_string)
      : content.replace(e.old_string, () => e.new_string);
    diffs.push([e.path, content, e.old_string, e.new_string]);
  }

  const attempted = new Map<string, string>();
  try {
    for (const file of files.values()) {
      // A throwing write can already have truncated the file.
      attempted.set(file.path, file.original);
      writeFileSync(file.path, file.updated, "utf-8");
    }
  } catch (err) {
    const failures = revertAll(attempted);
    const message = err instanceof Error ? err.message : String(err);
    const revertMessage = failures.length > 0
      ? `Failed to revert: ${failures.join(", ")}.`
      : "All edits reverted.";
    return { content: `Write failed: ${message}. ${revertMessage}`, is_error: true };
  }

  for (const edit of resolvedEdits) recordModification(edit.path);
  for (const file of files.values()) {
    trackFileChange(file.path, file.original, "multi_edit");
  }
  for (const diff of diffs) printEditDiff(...diff);

  return { content: `Applied ${resolvedEdits.length} edit(s) across ${files.size} file(s)` };
}

/** Revert files to originals. Returns list of paths that failed to revert. */
function revertAll(originals: Map<string, string>): string[] {
  const failures: string[] = [];
  for (const [path, content] of originals) {
    try {
      writeFileSync(path, content, "utf-8");
      recordModification(path);
    } catch {
      failures.push(path);
      recordModification(path);
      trackFileChange(path, content, "multi_edit");
    }
  }
  return failures;
}
