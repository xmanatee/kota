import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { recordModification } from "#core/file-tracking/file-tracker.js";
import { trackFileChange } from "#core/loop/file-changes.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { printEditDiff } from "./diff.js";
import { lintFile } from "./lint.js";

export const multiEditTool: Anthropic.Tool = {
  name: "multi_edit",
  description:
    "Apply multiple edits across one or more files atomically. " +
    "All edits succeed or all are reverted. Use this when making " +
    "related changes across multiple files to prevent partial updates.",
  input_schema: {
    type: "object" as const,
    properties: {
      edits: {
        type: "array",
        description: "Array of edits to apply atomically",
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

export async function runMultiEdit(input: Record<string, unknown>): Promise<ToolResult> {
  const edits = input.edits as EditEntry[] | undefined;
  if (!edits || !Array.isArray(edits) || edits.length === 0) {
    return { content: "Error: edits array is required and must not be empty", is_error: true };
  }

  // Phase 1: Validate all inputs upfront
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
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
      if (statSync(e.path).isDirectory()) {
        return { content: `Error: edit[${i}] ${e.path} is a directory, not a file`, is_error: true };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error: edit[${i}] failed to inspect ${e.path}: ${message}`, is_error: true };
    }
  }

  // Phase 2: Save originals for rollback
  const originals = new Map<string, string>();
  for (const e of edits) {
    if (!originals.has(e.path)) {
      originals.set(e.path, readFileSync(e.path, "utf-8"));
    }
  }

  // Phase 3: Apply edits sequentially, lint after each
  const filesModified = new Set<string>();
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const content = readFileSync(e.path, "utf-8");
    const count = content.split(e.old_string).length - 1;

    if (count === 0) {
      const rf = revertAll(originals);
      const revertMsg = rf.length > 0 ? `Failed to revert: ${rf.join(", ")}.` : "All edits reverted.";
      return { content: `Error: edit[${i}] old_string not found in ${e.path}. ${revertMsg}`, is_error: true };
    }

    if (count > 1 && !e.replace_all) {
      const rf = revertAll(originals);
      const revertMsg = rf.length > 0 ? `Failed to revert: ${rf.join(", ")}.` : "All edits reverted.";
      return {
        content: `Error: edit[${i}] old_string appears ${count} times in ${e.path}. ` +
          `Provide more context or set replace_all. ${revertMsg}`,
        is_error: true,
      };
    }

    const updated = e.replace_all ? content.replaceAll(e.old_string, e.new_string) : content.replace(e.old_string, e.new_string);
    writeFileSync(e.path, updated, "utf-8");

    const lint = lintFile(e.path);
    if (!lint.ok) {
      const rf = revertAll(originals);
      const revertMsg = rf.length > 0 ? `\nFailed to revert: ${rf.join(", ")}.` : "\nAll edits reverted.";
      return {
        content: `Edit[${i}] in ${e.path} caused syntax error:\n${lint.error}${revertMsg}`,
        is_error: true,
      };
    }

    printEditDiff(e.path, content, e.old_string, e.new_string);
    filesModified.add(e.path);
  }

  for (const path of filesModified) {
    recordModification(path);
    trackFileChange(path, originals.get(path) ?? null, "multi_edit");
  }

  return { content: `Applied ${edits.length} edit(s) across ${filesModified.size} file(s)` };
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
    }
  }
  return failures;
}

export const registration = {
  tool: multiEditTool,
  runner: runMultiEdit,
  risk: "moderate" as const,
  kind: "action" as const,
  group: "advanced_editing",
};
