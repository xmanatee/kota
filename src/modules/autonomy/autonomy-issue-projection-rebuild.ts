import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  AUTONOMY_ISSUE_PROJECTION_FILE,
  type AutonomyIssueDispositionUpdate,
  type AutonomyIssueObservation,
  buildAutonomyIssueObservation,
  readAutonomyIssueProjection,
  rebuildAutonomyIssueProjection,
  recordAutonomyIssueDispositions,
  stableAutonomyIssueKey,
} from "./autonomy-issue-projection.js";
import {
  projectAutonomyHealthEvidenceRefsForReview,
  projectAutonomyHealthSummariesForReview,
} from "./health-review-evidence-policy.js";
import type {
  AutonomyHealthActionability,
  AutonomyHealthEvidenceRef,
  AutonomyHealthJsonValue,
  AutonomyHealthObservation,
  AutonomyHealthSeverity,
  AutonomyHealthSignalSource,
} from "./health-signal.js";
import { isAutonomyHealthJsonObject } from "./health-signal.js";

const HEALTH_REVIEW_ARTIFACT = "autonomy-health-review.json";

function strings(value: AutonomyHealthJsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function severity(value: AutonomyHealthJsonValue | undefined): AutonomyHealthSeverity {
  if (
    value === "info" ||
    value === "warning" ||
    value === "error" ||
    value === "critical"
  ) {
    return value;
  }
  throw new Error("health review migration group has invalid severity");
}

function actionability(
  value: AutonomyHealthJsonValue | undefined,
): AutonomyHealthActionability {
  if (
    value === "local-code" ||
    value === "owner-action" ||
    value === "external-service" ||
    value === "informational"
  ) {
    return value;
  }
  throw new Error("health review migration group has invalid actionability");
}

function observationKind(
  value: AutonomyHealthJsonValue | undefined,
): AutonomyHealthObservation {
  if (value === "present" || value === "changed" || value === "cleared") {
    return value;
  }
  // Historical health signals represented presence implicitly. This is the
  // one rebuild boundary; live signals require an explicit observation kind.
  if (value === undefined) return "present";
  throw new Error("health review migration group has invalid observation kind");
}

function source(value: AutonomyHealthJsonValue | undefined): AutonomyHealthSignalSource {
  if (
    !isAutonomyHealthJsonObject(value) ||
    typeof value.kind !== "string" ||
    typeof value.id !== "string"
  ) {
    throw new Error("health review migration group has invalid source");
  }
  return {
    kind: value.kind,
    id: value.id,
    ...(typeof value.module === "string" ? { module: value.module } : {}),
    ...(typeof value.workflow === "string" ? { workflow: value.workflow } : {}),
    ...(typeof value.stepId === "string" ? { stepId: value.stepId } : {}),
  };
}

function evidenceRefs(
  value: AutonomyHealthJsonValue | undefined,
): AutonomyHealthEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AutonomyHealthEvidenceRef[] => {
    if (
      !isAutonomyHealthJsonObject(entry) ||
      typeof entry.kind !== "string" ||
      typeof entry.ref !== "string" ||
      (entry.kind !== "run" &&
        entry.kind !== "event" &&
        entry.kind !== "task" &&
        entry.kind !== "dead-letter" &&
        entry.kind !== "module-log" &&
        entry.kind !== "git" &&
        entry.kind !== "artifact")
    ) {
      return [];
    }
    return [
      {
        kind: entry.kind,
        ref: entry.ref,
        ...(typeof entry.summary === "string"
          ? { summary: entry.summary }
          : {}),
      },
    ];
  });
}

function observationFromGroup(
  group: AutonomyHealthJsonValue,
  generatedAt: string,
): AutonomyIssueObservation {
  if (!isAutonomyHealthJsonObject(group)) {
    throw new Error("health review migration group must be an object");
  }
  if (
    typeof group.dedupeKey !== "string" ||
    typeof group.observationCount !== "number" ||
    group.observationCount < 1
  ) {
    throw new Error("health review migration group has invalid identity or count");
  }
  const refs = evidenceRefs(group.evidenceRefs);
  if (refs.length === 0) {
    throw new Error("health review migration group has no evidence references");
  }
  const signalIds = strings(group.signalIds);
  if (signalIds.length === 0) {
    throw new Error("health review migration group has no signal ids");
  }
  return buildAutonomyIssueObservation({
    kind: observationKind(group.observation),
    rootCauseKey: group.dedupeKey,
    observedAt: generatedAt,
    signalIds,
    source: source(group.source),
    severity: severity(group.severity),
    actionability: actionability(group.actionability),
    labels: strings(group.labels),
    summaries: projectAutonomyHealthSummariesForReview(
      strings(group.summaries),
      refs,
    ),
    evidenceRefs: projectAutonomyHealthEvidenceRefsForReview(refs),
    observationCount: group.observationCount,
  });
}

function dispositionFromAction(
  action: AutonomyHealthJsonValue,
  decidedAt: string,
): AutonomyIssueDispositionUpdate | null {
  if (
    !isAutonomyHealthJsonObject(action) ||
    typeof action.dedupeKey !== "string" ||
    typeof action.kind !== "string"
  ) {
    return null;
  }
  const issueKey = stableAutonomyIssueKey(action.dedupeKey);
  if (
    (action.kind === "created-task" ||
      action.kind === "refreshed-task" ||
      action.kind === "skipped-task") &&
    typeof action.taskId === "string"
  ) {
    return {
      issueKey,
      kind: "task",
      decidedAt,
      taskIds: [action.taskId],
      ownerQuestionIds: [],
    };
  }
  if (
    (action.kind === "owner-question" ||
      action.kind === "skipped-owner-question") &&
    typeof action.questionId === "string"
  ) {
    return {
      issueKey,
      kind: "owner-question",
      decidedAt,
      taskIds: [],
      ownerQuestionIds: [action.questionId],
    };
  }
  if (action.kind === "attention") {
    return {
      issueKey,
      kind: "attention",
      decidedAt,
      taskIds: [],
      ownerQuestionIds: [],
    };
  }
  return null;
}

function collectHistoricalProjectionInputs(projectDir: string): {
  observations: AutonomyIssueObservation[];
  dispositions: AutonomyIssueDispositionUpdate[];
} {
  const runsDir = join(projectDir, ".kota", "runs");
  if (!existsSync(runsDir)) return { observations: [], dispositions: [] };
  const artifacts = readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const path = join(runsDir, entry.name, HEALTH_REVIEW_ARTIFACT);
      if (!existsSync(path)) return [];
      const value = readOptionalJsonFile<AutonomyHealthJsonValue>(path);
      if (!isAutonomyHealthJsonObject(value)) {
        throw new Error(`${path}: health review artifact must be an object`);
      }
      if (
        typeof value.generatedAt !== "string" ||
        !isAutonomyHealthJsonObject(value.review) ||
        !Array.isArray(value.review.groups)
      ) {
        throw new Error(`${path}: health review artifact has an invalid review`);
      }
      const applied = isAutonomyHealthJsonObject(value.actions) &&
          Array.isArray(value.actions.applied)
        ? value.actions.applied
        : [];
      return [{ generatedAt: value.generatedAt, groups: value.review.groups, applied }];
    })
    .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt));
  return {
    observations: artifacts.flatMap((artifact) =>
      artifact.groups.map((group) =>
        observationFromGroup(group, artifact.generatedAt),
      ),
    ),
    dispositions: artifacts.flatMap((artifact) =>
      artifact.applied.flatMap((action) => {
        const disposition = dispositionFromAction(action, artifact.generatedAt);
        return disposition === null ? [] : [disposition];
      }),
    ),
  };
}

export function initializeAutonomyIssueProjection(projectDir: string): void {
  if (existsSync(join(projectDir, AUTONOMY_ISSUE_PROJECTION_FILE))) return;
  const historical = collectHistoricalProjectionInputs(projectDir);
  rebuildAutonomyIssueProjection({
    projectDir,
    observations: historical.observations,
  });
  recordAutonomyIssueDispositions({
    projectDir,
    updates: historical.dispositions,
  });
  readAutonomyIssueProjection(projectDir);
}
