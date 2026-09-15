import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { taskQueueIntegrationPolicy } from "#modules/repo-tasks/task-integration-policy.js";
import { reviewBlockedEvidence } from "./evidence-review.js";
import { verifyBlockedContracts } from "./integration.js";
import { displayedOwnerAnswers } from "./owner-decision-authorization.js";
import {
  BLOCKED_OWNER_DECISION_REQUESTED_EVENT,
  BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
  blockedOwnerDecisionKey,
} from "./owner-decision-follow-up.js";
import { listBlockedTasksWithPreconditions } from "./promotion.js";
import {
  applyOutcome,
  inspectBlocked,
  inspectOwnerDecisionResolution,
  instructOperatorCapture,
  promoteAfterApproval,
  promoteDeterministic,
} from "./resolution-steps.js";

const writeBlockerActions = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-blocker-actions",
  type: "code",
  when: (ctx) => {
    const inspection = inspectBlocked.output(ctx);
    return inspection !== undefined && inspection.actions.length > 0;
  },
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const inspection = inspectBlocked.outputRequired(ctx);
    const instructions = instructOperatorCapture.output(ctx)?.instructions ?? [];
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    const filePath = join(ctx.workflow.runDirPath, "blocker-actions.json");
    writeFileSync(
      filePath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          actions: inspection.actions,
          operatorCaptureInstructionsEmitted: instructions,
        },
        null,
        2,
      )}\n`,
    );
    return { written: true, path: filePath };
  },
});

function workflowChangedAnything(
  promotions: number,
  followups: number,
  applications: number,
  instructions: number,
): boolean {
  return promotions + followups + applications + instructions > 0;
}

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  when: (ctx) =>
    (reviewBlockedEvidence.output(ctx)?.reviews.some((review) => review.promoted) ?? false) || workflowChangedAnything(
      (promoteDeterministic.output(ctx)?.promotions ?? []).length,
      (promoteAfterApproval.output(ctx)?.promotions ?? []).length,
      (applyOutcome.output(ctx) ?? []).length,
      (instructOperatorCapture.output(ctx)?.instructions ?? []).length,
    ),
  run: (ctx) => {
    const deterministic = promoteDeterministic.output(ctx)?.promotions ?? [];
    const followups = promoteAfterApproval.output(ctx)?.promotions ?? [];
    const applications = applyOutcome.output(ctx) ?? [];
    const instructions = instructOperatorCapture.output(ctx)?.instructions ?? [];
    const lines = [
      "blocked-promoter: promote satisfied tasks and refresh blocker markers",
      "",
      ...(reviewBlockedEvidence.output(ctx)?.reviews ?? [])
        .filter((review) => review.promoted)
        .map((review) => `- promote ${review.taskId}: ${review.reason}`),
      ...deterministic.map(
        (move) => `- promote ${move.id}: blocked -> ${move.toState} (precondition satisfied)`,
      ),
      ...followups.map(
        (move) => `- promote ${move.id}: blocked -> ${move.toState} (operator approved)`,
      ),
      ...applications.map((application) =>
        application.kind === "asked"
          ? `- refresh asked marker for slot ${application.slot} at ${application.lastAskedAt}`
          : `- write resolved marker for slot ${application.slot} at ${application.resolvedAt}`,
      ),
      ...instructions.map(
        (instruction) =>
          `- instruct operator capture for ${instruction.taskId} (${instruction.capturePath}, blocked ${instruction.ageDays}d)`,
      ),
    ];
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `${lines.join("\n")}\n`,
    );
    return { written: true };
  },
});

const blockedPromoterWorkflow: WorkflowDefinitionInput = {
  name: "blocked-promoter",
  repository: "write",
  resources: ({ scopeRoot, admittedResources }) => admittedResources ??
    listBlockedTasksWithPreconditions(scopeRoot).map((task) => `task:${task.id}`),
  integration: taskQueueIntegrationPolicy({ postReconcile: verifyBlockedContracts }),
  description:
    "Collect and review blocked evidence, promote satisfied preconditions, and reconcile owner decisions.",
  tags: ["monitored"],
  triggers: [
    { event: "autonomy.queue.empty", cooldownMs: 60_000, queueMode: "latest" },
    {
      event: "autonomy.queue.available",
      cooldownMs: 60_000,
      queueMode: "latest",
    },
    {
      event: BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
      cooldownMs: 0,
      queueMode: "all",
    },
  ],
  steps: [
    inspectOwnerDecisionResolution,
    inspectBlocked,
    reviewBlockedEvidence,
    promoteDeterministic,
    applyOutcome,
    promoteAfterApproval,
    instructOperatorCapture,
    writeBlockerActions,
    writeCommitMessage,
    {
      id: "emit-owner-decision-requested",
      type: "emit",
      when: (ctx) =>
        ctx.trigger.event !== BLOCKED_OWNER_DECISION_RESOLVED_EVENT &&
        inspectBlocked.outputRequired(ctx).ownerAsk !== null,
      event: BLOCKED_OWNER_DECISION_REQUESTED_EVENT,
      payload: (ctx) => {
        const candidate = inspectBlocked.outputRequired(ctx).ownerAsk;
        if (!candidate) throw new Error("owner-decision request has no candidate");
        const { taskPath: _taskPath, ...portableCandidate } = candidate;
        const requestKey = blockedOwnerDecisionKey(portableCandidate);
        return {
          idempotencyKey: requestKey,
          requestKey,
          candidate: portableCandidate,
          displayedAnswers: displayedOwnerAnswers(candidate),
        };
      },
    },
    {
      id: "emit-promoted",
      type: "emit",
      when: (ctx) =>
        writeCommitMessage.output(ctx)?.written === true &&
        (promoteDeterministic.output(ctx)?.promotions ?? []).length +
          (promoteAfterApproval.output(ctx)?.promotions ?? []).length +
          (reviewBlockedEvidence.output(ctx)?.reviews.filter((review) => review.promoted).length ?? 0) >
          0,
      event: "autonomy.blocked.promoted",
      payload: (ctx) => {
        const all = [
          ...(promoteDeterministic.output(ctx)?.promotions ?? []),
          ...(promoteAfterApproval.output(ctx)?.promotions ?? []),
        ];
        return {
          runId: ctx.workflow.runId,
          promotedTaskIds: [...all.map((move) => move.id),
            ...(reviewBlockedEvidence.output(ctx)?.reviews ?? []).filter((review) => review.promoted).map((review) => review.taskId)],
        };
      },
    },
    {
      id: "emit-operator-capture-instructed",
      type: "emit",
      when: (ctx) =>
        writeCommitMessage.output(ctx)?.written === true &&
        (instructOperatorCapture.output(ctx)?.instructions ?? []).length > 0,
      event: "autonomy.blocked.operator-capture-instructed",
      payload: (ctx) => ({
        runId: ctx.workflow.runId,
        instructions: (instructOperatorCapture.output(ctx)?.instructions ?? []).map(
          ({ taskId, capturePath, description, ageDays, instructedAt }) => ({
            taskId,
            capturePath,
            description,
            ageDays,
            instructedAt,
          }),
        ),
      }),
    },
  ],
};

export default blockedPromoterWorkflow;
