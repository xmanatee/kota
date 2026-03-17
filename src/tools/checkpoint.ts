import type Anthropic from "@anthropic-ai/sdk";
import { getChangeTracker } from "../file-changes.js";
import { recordModification } from "../file-tracker.js";
import type { ToolResult } from "./index.js";

export const checkpointTool: Anthropic.Tool = {
  name: "checkpoint",
  description:
    "Review and manage file changes made during this session. " +
    "Lists modified files, shows diffs against original state, " +
    "and can restore files to their pre-modification state. " +
    "Changes are tracked automatically — no setup needed.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["list", "diff", "restore", "restore_all"],
        description:
          "list: show all modified files with change counts. " +
          "diff: show changes to a file vs. its original state. " +
          "restore: restore a file to its original (pre-modification) state. " +
          "restore_all: restore ALL modified files to their original state.",
      },
      path: {
        type: "string",
        description: "File path (required for diff and restore actions)",
      },
    },
    required: ["action"],
  },
};

export async function runCheckpoint(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const action = input.action as string;
  const path = input.path as string | undefined;

  const tracker = getChangeTracker();
  if (!tracker) {
    return { content: "Change tracking is not active.", is_error: true };
  }

  switch (action) {
    case "list":
      return listChanges(tracker);
    case "diff":
      return diffFile(tracker, path);
    case "restore":
      return restoreFile(tracker, path);
    case "restore_all":
      return restoreAllFiles(tracker);
    default:
      return {
        content: `Unknown action: ${action}. Use: list, diff, restore, restore_all`,
        is_error: true,
      };
  }
}

function listChanges(tracker: ReturnType<typeof getChangeTracker> & object): ToolResult {
  const files = tracker.getTrackedFiles();
  if (files.length === 0) {
    return { content: "No file changes tracked in this session." };
  }

  const lines = files.map((f) => {
    const tag = f.isNew ? " [new]" : "";
    return `  ${f.path}${tag}: ${f.changeCount} change(s) via ${f.lastTool}`;
  });

  return {
    content:
      `${tracker.totalChanges} change(s) across ${files.length} file(s):\n` +
      lines.join("\n") +
      "\n\nUse checkpoint(diff, path) to see changes, checkpoint(restore, path) to undo.",
  };
}

function diffFile(tracker: ReturnType<typeof getChangeTracker> & object, path?: string): ToolResult {
  if (!path) {
    return { content: "Error: path is required for diff action", is_error: true };
  }

  const result = tracker.diff(path);
  if (result.error) {
    return { content: `Error: ${result.error}`, is_error: true };
  }

  return { content: result.content };
}

function restoreFile(tracker: ReturnType<typeof getChangeTracker> & object, path?: string): ToolResult {
  if (!path) {
    return { content: "Error: path is required for restore action", is_error: true };
  }

  const result = tracker.restore(path);
  if (!result.success) {
    return { content: `Error restoring ${path}: ${result.error}`, is_error: true };
  }

  recordModification(path);
  return { content: `Restored ${path} to its original state.` };
}

function restoreAllFiles(tracker: ReturnType<typeof getChangeTracker> & object): ToolResult {
  const files = tracker.getTrackedFiles();
  if (files.length === 0) {
    return { content: "No file changes to restore." };
  }

  const result = tracker.restoreAll();
  for (const path of result.restored) recordModification(path);

  const parts: string[] = [];
  if (result.restored.length > 0) {
    parts.push(`Restored ${result.restored.length} file(s):\n${result.restored.map((p) => `  ${p}`).join("\n")}`);
  }
  if (result.errors.length > 0) {
    parts.push(
      `Failed to restore ${result.errors.length} file(s):\n${result.errors.map((e) => `  ${e.path}: ${e.error}`).join("\n")}`,
    );
  }

  return {
    content: parts.join("\n\n"),
    is_error: result.errors.length > 0,
  };
}
export const registration = {
	tool: checkpointTool,
	runner: runCheckpoint,
	risk: "safe" as const,
};
