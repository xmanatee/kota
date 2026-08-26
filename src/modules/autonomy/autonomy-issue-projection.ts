import { join } from "node:path";
import {
  readOptionalJsonFile,
  writeJsonFileAtomic,
} from "#core/util/json-file.js";
import {
  uniqueAutonomyIssueStrings,
} from "./autonomy-issue-observation.js";
import { reduceAutonomyIssueProjection } from "./autonomy-issue-projection-reducer.js";
import {
  AUTONOMY_ISSUE_PROJECTION_FILE,
  type AutonomyIssue,
  type AutonomyIssueDispositionUpdate,
  type AutonomyIssueObservation,
  type AutonomyIssueProjection,
  type AutonomyIssueProjectionResult,
  type AutonomyIssueStatus,
} from "./autonomy-issue-projection-types.js";
import type { AutonomyHealthJsonValue } from "./health-signal.js";
import { isAutonomyHealthJsonObject } from "./health-signal.js";

export {
  buildAutonomyIssueObservation,
  stableAutonomyIssueKey,
} from "./autonomy-issue-observation.js";
export { reduceAutonomyIssueProjection } from "./autonomy-issue-projection-reducer.js";
export type * from "./autonomy-issue-projection-types.js";
export { AUTONOMY_ISSUE_PROJECTION_FILE };

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
  return value as AutonomyIssueProjection;
}

export function emptyAutonomyIssueProjection(): AutonomyIssueProjection {
  return { schemaVersion: 1, updatedAt: null, issues: [] };
}

function projectionPath(workspaceRoot: string): string {
  return join(workspaceRoot, AUTONOMY_ISSUE_PROJECTION_FILE);
}

export function readAutonomyIssueProjection(
  workspaceRoot: string,
): AutonomyIssueProjection {
  const raw = readOptionalJsonFile<AutonomyHealthJsonValue>(
    projectionPath(workspaceRoot),
  );
  return decodeAutonomyIssueProjection(raw);
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
    if (!update || issue.status === "resolved") return issue;
    changed = true;
    return {
      ...issue,
      status: update.kind === "accepted" ||
          update.kind === "duplicate" ||
          update.kind === "no-action"
        ? "resolved" as const
        : update.kind === "owner-question"
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

export function materializeAutonomyIssueProjection(
  workspaceRoot: string,
  projection: AutonomyIssueProjection,
): void {
  writeJsonFileAtomic(projectionPath(workspaceRoot), projection);
}

export function listAutonomyIssues(
  workspaceRoot: string,
  statuses?: readonly AutonomyIssueStatus[],
): AutonomyIssue[] {
  const selected = statuses === undefined ? null : new Set(statuses);
  return readAutonomyIssueProjection(workspaceRoot).issues.filter(
    (issue) => selected === null || selected.has(issue.status),
  );
}
