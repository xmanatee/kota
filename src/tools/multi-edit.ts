import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { ToolResult } from "./index.js";
import { lintFile } from "../lint.js";
import { printEditDiff } from "../diff.js";

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
      revertAll(originals);
      return { content: `Error: edit[${i}] old_string not found in ${e.path}. All edits reverted.`, is_error: true };
    }

    if (count > 1 && !e.replace_all) {
      revertAll(originals);
      return {
        content: `Error: edit[${i}] old_string appears ${count} times in ${e.path}. ` +
          `Provide more context or set replace_all. All edits reverted.`,
        is_error: true,
      };
    }

    const updated = e.replace_all ? content.replaceAll(e.old_string, e.new_string) : content.replace(e.old_string, e.new_string);
    writeFileSync(e.path, updated, "utf-8");

    const lint = lintFile(e.path);
    if (!lint.ok) {
      revertAll(originals);
      return {
        content: `Edit[${i}] in ${e.path} caused syntax error:\n${lint.error}\nAll edits reverted.`,
        is_error: true,
      };
    }

    printEditDiff(e.path, content, e.old_string, e.new_string);
    filesModified.add(e.path);
  }

  return { content: `Applied ${edits.length} edit(s) across ${filesModified.size} file(s)` };
}

function revertAll(originals: Map<string, string>): void {
  for (const [path, content] of originals) {
    writeFileSync(path, content, "utf-8");
  }
}
