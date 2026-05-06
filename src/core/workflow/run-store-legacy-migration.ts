import { isPlainObject, isWorkflowRunStatus } from "./run-store-state-schema.js";
import type { WorkflowStateEntry } from "./run-types.js";

/**
 * Convert a legacy per-workflow entry (lastRunId/lastStartedAt/lastCompletedAt/
 * lastStatus flat fields) into the discriminated {lastStarted, lastCompletion}
 * shape. Returns `null` when the entry does not appear to be legacy, so callers
 * can short-circuit without touching already-migrated files.
 *
 * Legacy conflated two different runs into one entry when a run was active:
 * lastRunId/lastStartedAt pointed to the running run while lastCompletedAt/
 * lastStatus carried an older completion. Migration resolves that ambiguity by
 * checking activeRuns: a run that is still active only contributes lastStarted,
 * and the stale completion fields are dropped rather than falsely attributed.
 */
function migrateLegacyWorkflowEntry(
  entry: Record<string, unknown>,
  activeRunIds: ReadonlySet<string>,
): WorkflowStateEntry | null {
  const hasLegacyField =
    "lastRunId" in entry ||
    "lastStartedAt" in entry ||
    "lastCompletedAt" in entry ||
    "lastStatus" in entry;
  if (!hasLegacyField) return null;

  const migrated: WorkflowStateEntry = {};
  if (typeof entry.nextScheduledAt === "string" && entry.nextScheduledAt.trim()) {
    migrated.nextScheduledAt = entry.nextScheduledAt;
  }

  const lastRunId = typeof entry.lastRunId === "string" ? entry.lastRunId : null;
  const lastStartedAt = typeof entry.lastStartedAt === "string" ? entry.lastStartedAt : null;
  const lastCompletedAt = typeof entry.lastCompletedAt === "string" ? entry.lastCompletedAt : null;
  const lastStatus = isWorkflowRunStatus(entry.lastStatus) ? entry.lastStatus : null;

  if (lastRunId && lastStartedAt) {
    migrated.lastStarted = { runId: lastRunId, startedAt: lastStartedAt };
  }

  const runIsActive = lastRunId !== null && activeRunIds.has(lastRunId);
  if (
    !runIsActive &&
    lastRunId &&
    lastStartedAt &&
    lastCompletedAt &&
    lastStatus
  ) {
    migrated.lastCompletion = {
      runId: lastRunId,
      startedAt: lastStartedAt,
      completedAt: lastCompletedAt,
      status: lastStatus,
    };
  }

  return migrated;
}

/**
 * Migrate legacy per-workflow entries in a parsed state object in place.
 * Returns true when at least one entry was rewritten.
 */
export function migrateLegacyWorkflowState(raw: Record<string, unknown>): boolean {
  const workflows = raw.workflows;
  if (!isPlainObject(workflows)) return false;

  const activeRunIds = new Set<string>();
  if (Array.isArray(raw.activeRuns)) {
    for (const run of raw.activeRuns) {
      if (isPlainObject(run) && typeof run.runId === "string") {
        activeRunIds.add(run.runId);
      }
    }
  }

  let changed = false;
  for (const [name, entry] of Object.entries(workflows)) {
    if (!isPlainObject(entry)) continue;
    const migrated = migrateLegacyWorkflowEntry(entry, activeRunIds);
    if (migrated !== null) {
      workflows[name] = migrated;
      changed = true;
    }
  }
  return changed;
}
