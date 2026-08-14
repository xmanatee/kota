import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { TrajectoryDiagnosticsArtifact } from "#core/agent-harness/index.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import type { BusEvents } from "#core/events/event-bus.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { subscribeDeadLetterChanges } from "./autonomy-issue-dead-letter-source.js";
import { readAutonomyIssueProjection } from "./autonomy-issue-projection.js";
import {
  emitHealth,
  stableIssueHash,
  stableToken,
  WORKFLOW_FAILURE_HEALTH_LABELS,
  workflowFailureHealthSource,
  workflowFailureIssueKey,
} from "./autonomy-issue-source-shared.js";
import {
  type AutonomyHealthJsonObject,
  type AutonomyHealthJsonValue,
  isAutonomyHealthJsonObject,
} from "./health-signal.js";

type JsonObject = AutonomyHealthJsonObject;
export type AutonomyIssueSourceContext = Pick<
  ModuleRuntimeContext,
  "cwd" | "events"
>;

function projectPath(projectDir: string, candidate: string): string | null {
  const absolute = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(projectDir, candidate);
  const rel = relative(resolve(projectDir), absolute);
  if (
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  ) {
    return null;
  }
  return absolute;
}

function readJson(path: string): AutonomyHealthJsonValue {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as AutonomyHealthJsonValue;
  } catch {
    return null;
  }
}

function subscribeWorkflowFailures(ctx: AutonomyIssueSourceContext): void {
  ctx.events.subscribe("workflow.failure.alert", (payload) => {
    emitHealth(ctx, payload.projectId, {
      observation: "present",
      source: workflowFailureHealthSource(payload.workflow),
      severity: "critical",
      labels: WORKFLOW_FAILURE_HEALTH_LABELS,
      summary: `${payload.workflow} ${payload.status}; the exact run artifact owns failure detail.`,
      evidenceRefs: [
        {
          kind: "run",
          ref: `.kota/runs/${payload.runId}/metadata.json`,
        },
      ],
      actionability: "local-code",
      dedupeKey: workflowFailureIssueKey({
        workflowName: payload.workflow,
        errorSummary: payload.errorSummary,
        fallback: payload.status,
      }),
      observationCount: 1,
      createdAt: new Date().toISOString(),
    });
  });
}

function trajectoryArtifact(
  value: AutonomyHealthJsonValue,
): TrajectoryDiagnosticsArtifact | null {
  if (
    !isAutonomyHealthJsonObject(value) ||
    value.version !== 1 ||
    !Array.isArray(value.diagnostics)
  ) {
    return null;
  }
  return value as TrajectoryDiagnosticsArtifact;
}

function emitTrajectoryObservations(
  ctx: AutonomyIssueSourceContext,
  payload: BusEvents["workflow.step.completed"],
): void {
  const diagnostics = payload.trajectoryDiagnostics;
  if (
    diagnostics === undefined ||
    typeof diagnostics.artifactPath !== "string"
  ) return;
  if (
    typeof payload.projectId !== "string" ||
    typeof payload.workflow !== "string" ||
    typeof payload.runId !== "string" ||
    typeof payload.stepId !== "string"
  ) {
    return;
  }
  const path = projectPath(ctx.cwd, diagnostics.artifactPath);
  if (!path) return;
  const artifact = trajectoryArtifact(readJson(path));
  if (!artifact) return;
  for (const diagnostic of artifact.diagnostics) {
    if (diagnostic.code === "unsupported_trajectory") continue;
    emitHealth(ctx, payload.projectId, {
      observation: "present",
      source: {
        kind: "workflow-step",
        id: `${payload.workflow}:${payload.stepId}`,
        workflow: payload.workflow,
        stepId: payload.stepId,
      },
      severity: "warning",
      labels: ["trajectory", diagnostic.code.replaceAll("_", "-")],
      summary: diagnostic.summary,
      evidenceRefs: [
        {
          kind: "artifact",
          ref: relative(ctx.cwd, path),
        },
      ],
      actionability: "local-code",
      dedupeKey:
        `workflow:${stableToken(payload.workflow)}:trajectory:` +
        `${stableToken(payload.stepId)}:${stableToken(diagnostic.code)}`,
      observationCount: 1,
      createdAt: new Date().toISOString(),
    });
  }
}

function emitReviewScrutinyObservation(
  ctx: AutonomyIssueSourceContext,
  payload: JsonObject,
  seen: Set<string>,
): void {
  if (
    typeof payload.projectId !== "string" ||
    typeof payload.runDir !== "string"
  ) {
    return;
  }
  const path = projectPath(ctx.cwd, `${payload.runDir}/review-scrutiny.json`);
  if (!path) return;
  const record = readJson(path);
  if (
    !isAutonomyHealthJsonObject(record) ||
    record.thinAcceptance !== true ||
    typeof record.runId !== "string" ||
    typeof record.workflow !== "string" ||
    typeof record.surface !== "string" ||
    typeof record.generatedAt !== "string"
  ) {
    return;
  }
  const observationId = [
    record.runId,
    record.surface,
    record.generatedAt,
  ].join(":");
  if (seen.has(observationId)) return;
  seen.add(observationId);
  const taskKey = typeof record.taskId === "string" ? record.taskId : "unscoped";
  emitHealth(ctx, payload.projectId, {
    observation: "present",
    source: {
      kind: "review",
      id: record.surface,
      workflow: record.workflow,
    },
    severity: "warning",
    labels: ["quality", "review-scrutiny", stableToken(record.surface)],
    summary: `${record.surface} recorded a thin acceptance for ${taskKey}.`,
    evidenceRefs: [{ kind: "artifact", ref: relative(ctx.cwd, path) }],
    actionability: "local-code",
    dedupeKey:
      `review-scrutiny:${stableToken(record.surface)}:` +
      `${stableToken(record.workflow)}:${stableToken(taskKey)}`,
    observationCount: 1,
    createdAt: record.generatedAt,
  });
}

function subscribeStepObservations(ctx: AutonomyIssueSourceContext): void {
  const seenReviewRecords = new Set<string>();
  ctx.events.subscribe("workflow.step.completed", (payload) => {
    const objectPayload = payload as JsonObject;
    emitTrajectoryObservations(ctx, payload);
    emitReviewScrutinyObservation(ctx, objectPayload, seenReviewRecords);
  });
}

function subscribeOwnerInterventions(ctx: AutonomyIssueSourceContext): void {
  const queue = new OwnerQuestionQueue(
    resolve(ctx.cwd, ".kota", "owner-questions"),
  );
  ctx.events.subscribe("owner.question.changed", (payload) => {
    const question = queue.get(payload.id);
    if (!question || question.status === "pending") return;
    const linkedIssue = readAutonomyIssueProjection(ctx.cwd).issues.find(
      (issue) => issue.links.ownerQuestionIds.includes(question.id),
    );
    if (linkedIssue) {
      emitHealth(ctx, payload.projectId, {
        observation: "changed",
        source: linkedIssue.source,
        severity: linkedIssue.severity,
        labels: linkedIssue.labels,
        summary:
          `Owner question ${payload.id} reached ${question.status}; ` +
          "the linked owner-question record now carries the owner's disposition.",
        evidenceRefs: [
          {
            kind: "event",
            ref: `owner.question.changed#${payload.id}`,
          },
        ],
        actionability: linkedIssue.actionability,
        dedupeKey: linkedIssue.rootCauseKey,
        observationCount: 1,
        createdAt: question.resolvedAt ?? new Date().toISOString(),
      });
      return;
    }
    const topic = question.dedupeKey ??
      `${stableToken(question.source)}:${stableIssueHash(question.question.toLowerCase())}`;
    emitHealth(ctx, payload.projectId, {
      observation: "present",
      source: { kind: "owner-question", id: stableToken(question.source) },
      severity: "warning",
      labels: ["owner-intervention", question.status],
      summary:
        `Owner question ${payload.id} reached ${question.status}; the owner-question record owns the answer.`,
      evidenceRefs: [
        {
          kind: "event",
          ref: `owner.question.changed#${payload.id}`,
        },
      ],
      actionability: "local-code",
      dedupeKey: `owner-intervention:${stableToken(topic)}`,
      observationCount: 1,
      createdAt: question.resolvedAt ?? new Date().toISOString(),
    });
  });
}

export function subscribeAutonomyIssueSources(ctx: AutonomyIssueSourceContext): void {
  subscribeWorkflowFailures(ctx);
  subscribeStepObservations(ctx);
  subscribeOwnerInterventions(ctx);
  subscribeDeadLetterChanges(ctx);
}
