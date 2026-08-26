import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { subscribeBuilderInterruptions } from "./autonomy-issue-builder-interruption-source.js";
import { subscribeDeadLetterChanges } from "./autonomy-issue-dead-letter-source.js";
import { readAutonomyIssueProjection } from "./autonomy-issue-projection.js";
import { resolveAutonomyIssueRuntimeScope } from "./autonomy-issue-runtime-scope.js";
import {
  emitHealth,
  stableIssueHash,
  stableToken,
  WORKFLOW_FAILURE_HEALTH_LABELS,
  workflowFailureHealthSource,
  workflowFailureIssueKey,
} from "./autonomy-issue-source-shared.js";
export type AutonomyIssueSourceContext = Pick<
  ModuleRuntimeContext,
  "events" | "getProvider"
>;

function subscribeWorkflowFailures(ctx: AutonomyIssueSourceContext): void {
  ctx.events.subscribe("workflow.failure.alert", (payload) => {
    const runtime = resolveAutonomyIssueRuntimeScope(ctx, payload);
    emitHealth(ctx, runtime.scopeId, {
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

function subscribeEvalRegressions(ctx: AutonomyIssueSourceContext): void {
  ctx.events.subscribe("eval-harness.regression.detected", (payload) => {
    const runtime = resolveAutonomyIssueRuntimeScope(ctx, payload);
    emitHealth(ctx, runtime.scopeId, {
      observation: "present",
      source: {
        kind: "workflow",
        id: "eval-harness-cadence",
        workflow: "eval-harness-cadence",
      },
      severity: "warning",
      labels: ["quality", "eval-regression", stableToken(payload.hostClass)],
      summary: payload.reason,
      evidenceRefs: [{
        kind: "artifact",
        ref: payload.runArtifactBaseDir,
        summary: "eval regression run artifacts",
      }],
      actionability: "local-code",
      dedupeKey: `eval-harness:regression:${stableToken(payload.hostClass)}`,
      observationCount: 1,
      createdAt: new Date().toISOString(),
    });
  });
}

function subscribeOwnerInterventions(ctx: AutonomyIssueSourceContext): void {
  ctx.events.subscribe("owner.question.changed", (payload) => {
    const runtime = resolveAutonomyIssueRuntimeScope(ctx, payload);
    const question = runtime.ownerQuestionQueue.get(payload.id);
    if (!question || question.status === "pending") return;
    const linkedIssue = readAutonomyIssueProjection(runtime.workspaceRoot).issues.find(
      (issue) => issue.links.ownerQuestionIds.includes(question.id),
    );
    if (linkedIssue) {
      emitHealth(ctx, runtime.scopeId, {
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
    emitHealth(ctx, runtime.scopeId, {
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
  subscribeEvalRegressions(ctx);
  subscribeOwnerInterventions(ctx);
  subscribeDeadLetterChanges(ctx);
  subscribeBuilderInterruptions(ctx);
}
