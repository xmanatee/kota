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

function assertProjection(value: AutonomyHealthJsonValue): AutonomyIssueProjection {
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

function projectionPath(projectDir: string): string {
  return join(projectDir, AUTONOMY_ISSUE_PROJECTION_FILE);
}

export function readAutonomyIssueProjection(
  projectDir: string,
): AutonomyIssueProjection {
  const raw = readOptionalJsonFile<AutonomyHealthJsonValue>(
    projectionPath(projectDir),
  );
  return raw === null ? emptyAutonomyIssueProjection() : assertProjection(raw);
}

export function applyAutonomyIssueObservations(args: {
  projectDir: string;
  observations: readonly AutonomyIssueObservation[];
}): AutonomyIssueProjectionResult {
  const result = reduceAutonomyIssueProjection(
    readAutonomyIssueProjection(args.projectDir),
    args.observations,
  );
  if (result.transitions.some((transition) => transition.kind !== "replayed")) {
    writeJsonFileAtomic(projectionPath(args.projectDir), result.projection);
  }
  return result;
}

export function rebuildAutonomyIssueProjection(args: {
  projectDir: string;
  observations: readonly AutonomyIssueObservation[];
}): AutonomyIssueProjectionResult {
  const result = reduceAutonomyIssueProjection(
    emptyAutonomyIssueProjection(),
    args.observations,
  );
  writeJsonFileAtomic(projectionPath(args.projectDir), result.projection);
  return result;
}

export function recordAutonomyIssueDispositions(args: {
  projectDir: string;
  updates: readonly AutonomyIssueDispositionUpdate[];
}): AutonomyIssueProjection {
  const current = readAutonomyIssueProjection(args.projectDir);
  if (args.updates.length === 0) return current;
  const updates = new Map<string, AutonomyIssueDispositionUpdate>();
  for (const update of args.updates) {
    const existing = updates.get(update.issueKey);
    if (!existing) {
      updates.set(update.issueKey, update);
      continue;
    }
    const latest = update.decidedAt >= existing.decidedAt ? update : existing;
    updates.set(update.issueKey, {
      ...latest,
      taskIds: uniqueAutonomyIssueStrings([
        ...existing.taskIds,
        ...update.taskIds,
      ]),
      ownerQuestionIds: uniqueAutonomyIssueStrings([
        ...existing.ownerQuestionIds,
        ...update.ownerQuestionIds,
      ]),
    });
  }
  let changed = false;
  const issues = current.issues.map((issue) => {
    const update = updates.get(issue.issueKey);
    if (!update || issue.status === "resolved") return issue;
    changed = true;
    return {
      ...issue,
      status:
        update.kind === "owner-question"
          ? "needs-decision" as const
          : "open" as const,
      disposition: {
        kind: update.kind,
        updatedAt: update.decidedAt,
        semanticRevision: issue.semanticRevision,
      },
      links: {
        ...issue.links,
        taskIds: uniqueAutonomyIssueStrings([
          ...issue.links.taskIds,
          ...update.taskIds,
        ]),
        ownerQuestionIds: uniqueAutonomyIssueStrings([
          ...issue.links.ownerQuestionIds,
          ...update.ownerQuestionIds,
        ]),
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
  writeJsonFileAtomic(projectionPath(args.projectDir), projection);
  return projection;
}

export function recordAutonomyIssueRecoveryDisposition(args: {
  projectDir: string;
  taskId: string;
  recoveryDispositionRef: string;
  recordedAt: string;
}): AutonomyIssueProjection {
  const current = readAutonomyIssueProjection(args.projectDir);
  let changed = false;
  const issues = current.issues.map((issue) => {
    if (
      !issue.links.taskIds.includes(args.taskId) ||
      issue.links.recoveryDispositionRefs.includes(args.recoveryDispositionRef)
    ) {
      return issue;
    }
    changed = true;
    return {
      ...issue,
      links: {
        ...issue.links,
        recoveryDispositionRefs: uniqueAutonomyIssueStrings([
          ...issue.links.recoveryDispositionRefs,
          args.recoveryDispositionRef,
        ]),
      },
    };
  });
  if (!changed) return current;
  const projection = {
    ...current,
    updatedAt: [
      ...(current.updatedAt === null ? [] : [current.updatedAt]),
      args.recordedAt,
    ].sort().at(-1)!,
    issues,
  };
  writeJsonFileAtomic(projectionPath(args.projectDir), projection);
  return projection;
}

export function listAutonomyIssues(
  projectDir: string,
  statuses?: readonly AutonomyIssueStatus[],
): AutonomyIssue[] {
  const selected = statuses === undefined ? null : new Set(statuses);
  return readAutonomyIssueProjection(projectDir).issues.filter(
    (issue) => selected === null || selected.has(issue.status),
  );
}
