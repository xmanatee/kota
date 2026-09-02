import { join } from "node:path";
import { EventJournal } from "#core/events/event-journal.js";
import type { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function statusIcon(status: string): string {
  switch (status) {
    case "success": return "✓";
    case "failed": return "✗";
    case "interrupted": return "⚡";
    case "running": return "▶";
    case "skipped": return "–";
    case "completed-with-warnings": return "⚠";
    default: return "?";
  }
}

export function listRuns(store: WorkflowRunStore, limit: number): WorkflowRunMetadata[] {
  return store.listRuns({ limit });
}

export function eventJournalForScope(workspaceRoot: string): EventJournal {
  return new EventJournal(join(workspaceRoot, ".kota", "events"));
}
