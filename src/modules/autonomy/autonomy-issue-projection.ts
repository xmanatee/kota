import { existsSync } from "node:fs";
import { join } from "node:path";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { RunStateReader } from "#core/workflow/run-state-reader-provider.js";
import {
  uniqueAutonomyIssueStrings,
} from "./autonomy-issue-observation.js";
import { reduceAutonomyIssueProjection } from "./autonomy-issue-projection-reducer.js";
import type {
  AutonomyIssue,
  AutonomyIssueDispositionUpdate,
  AutonomyIssueObservation,
  AutonomyIssueProjection,
  AutonomyIssueProjectionResult,
  AutonomyIssueStatus,
} from "./autonomy-issue-projection-types.js";
import type { AutonomyHealthJsonValue } from "./health-signal.js";
import { isAutonomyHealthJsonObject, normalizeEvidenceRefs } from "./health-signal.js";

export {
  buildAutonomyIssueObservation,
  stableAutonomyIssueKey,
} from "./autonomy-issue-observation.js";
export { reduceAutonomyIssueProjection } from "./autonomy-issue-projection-reducer.js";
export type * from "./autonomy-issue-projection-types.js";

export const AUTONOMY_ISSUE_PROJECTION_RESOURCE =
  "autonomy:issue-projection";
export const AUTONOMY_ISSUE_PROJECTION_STATE_KEY =
  "autonomy/issues/projection";

export function decodeAutonomyIssueProjection(
  value: AutonomyHealthJsonValue | undefined,
): AutonomyIssueProjection {
  if (value === null || value === undefined) return emptyAutonomyIssueProjection();
  if (
    !isAutonomyHealthJsonObject(value) ||
    value.schemaVersion !== 1 ||
    (value.updatedAt !== null && typeof value.updatedAt !== "string") ||
    !Array.isArray(value.issues)
  ) {
    throw new Error("autonomy issue projection has an invalid envelope");
  }
  if (value.moduleRecoveries !== undefined) {
    if (!Array.isArray(value.moduleRecoveries)) throw new Error("invalid module recoveries");
    for (const recovery of value.moduleRecoveries) {
      if (!isAutonomyHealthJsonObject(recovery) ||
        typeof recovery.module !== "string" || !recovery.module ||
        typeof recovery.operation !== "string" || !recovery.operation ||
        typeof recovery.observationId !== "string" || !recovery.observationId ||
        typeof recovery.observedAt !== "string" || !Number.isFinite(Date.parse(recovery.observedAt))) {
        throw new Error("invalid module recovery");
      }
      const refs = normalizeEvidenceRefs(recovery.evidenceRefs);
      if (!refs.every((ref) => ref.moduleOperation !== undefined && ref.moduleOperation.operation === recovery.operation &&
        ref.moduleOperation.observation === "cleared" && ref.moduleOperation.observedAt === recovery.observedAt)) {
        throw new Error("module recovery evidence does not match its boundary");
      }
    }
  }
  for (const issue of value.issues) {
    if (
      !isAutonomyHealthJsonObject(issue) ||
      typeof issue.issueKey !== "string" ||
      typeof issue.rootCauseKey !== "string" ||
      (issue.status !== "open" &&
        issue.status !== "needs-decision" &&
        issue.status !== "resolved") ||
      typeof issue.semanticRevision !== "number" ||
      !Array.isArray(issue.history) ||
      !isAutonomyHealthJsonObject(issue.links) ||
      !isAutonomyHealthJsonObject(issue.disposition)
    ) {
      throw new Error("autonomy issue projection contains an invalid issue");
    }
  }
  for (const issue of value.issues) {
    if (!isAutonomyHealthJsonObject(issue)) continue;
    for (const entry of [issue, ...(Array.isArray(issue.history) ? issue.history : [])]) {
      if (!isAutonomyHealthJsonObject(entry) || !Array.isArray(entry.evidenceRefs)) continue;
      if (entry.evidenceRefs.some((ref) => isAutonomyHealthJsonObject(ref) && ref.moduleOperation !== undefined)) normalizeEvidenceRefs(entry.evidenceRefs);
    }
  }
  return value as AutonomyIssueProjection;
}

export function emptyAutonomyIssueProjection(): AutonomyIssueProjection {
  return { schemaVersion: 1, updatedAt: null, issues: [] };
}

export function readAutonomyIssueProjection(
  scopeRoot: string,
  stateDir: string | RunStateReader,
): AutonomyIssueProjection {
  if (typeof stateDir !== "string") {
    const scopeId = stateDir.getScopeIdByRootPath(scopeRoot);
    return scopeId === null ? emptyAutonomyIssueProjection() : decodeAutonomyIssueProjection(
      stateDir.readScopeStateValue<AutonomyIssueProjection>(scopeId, AUTONOMY_ISSUE_PROJECTION_STATE_KEY).value,
    );
  }
  if (!existsSync(join(stateDir, "kota.sqlite"))) return emptyAutonomyIssueProjection();
  const database = RunStateDatabase.openReadOnly(stateDir);
  try {
    return readAutonomyIssueProjection(scopeRoot, database);
  } finally {
    database.close();
  }
}

export function applyAutonomyIssueObservations(args: {
  current: AutonomyIssueProjection;
  observations: readonly AutonomyIssueObservation[];
}): AutonomyIssueProjectionResult {
  return reduceAutonomyIssueProjection(args.current, args.observations);
}

export function recordAutonomyIssueDispositions(args: {
  current: AutonomyIssueProjection;
  updates: readonly AutonomyIssueDispositionUpdate[];
}): AutonomyIssueProjection {
  const current = args.current;
  if (args.updates.length === 0) return current;
  const updates = new Map<string, AutonomyIssueDispositionUpdate>();
  for (const update of args.updates) {
    const existing = updates.get(update.issueKey);
    if (!existing) {
      updates.set(update.issueKey, update);
      continue;
    }
    const latest = update.decidedAt >= existing.decidedAt ? update : existing;
    updates.set(update.issueKey, latest);
  }
  let changed = false;
  const issues = current.issues.map((issue) => {
    const update = updates.get(issue.issueKey);
    if (
      !update ||
      issue.status === "resolved" ||
      issue.semanticRevision !== update.semanticRevision
    ) {
      return issue;
    }
    changed = true;
    return {
      ...issue,
      status: update.kind === "owner-question"
        ? "needs-decision" as const
        : "open" as const,
      disposition: {
        kind: update.kind,
        updatedAt: update.decidedAt,
        semanticRevision: issue.semanticRevision,
      },
      links: {
        ...issue.links,
        taskIds: uniqueAutonomyIssueStrings(update.taskIds),
        ownerQuestionIds: uniqueAutonomyIssueStrings(update.ownerQuestionIds),
      },
    };
  });
  if (!changed) return current;
  const projection = {
    ...current,
    updatedAt: [
      ...(current.updatedAt === null ? [] : [current.updatedAt]),
      ...args.updates.map((update) => update.decidedAt),
    ].sort().at(-1)!,
    issues,
  };
  return projection;
}

export function listAutonomyIssues(
  scopeRoot: string,
  stateDir: string,
  statuses?: readonly AutonomyIssueStatus[],
): AutonomyIssue[] {
  const selected = statuses === undefined ? null : new Set(statuses);
  return readAutonomyIssueProjection(scopeRoot, stateDir).issues.filter(
    (issue) => selected === null || selected.has(issue.status),
  );
}
