import { existsSync } from "node:fs";
import { repoWorktreeStatusOperation } from "#core/util/repo-worktree-operation.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import {
  type ApplyHealthReviewActionsOutput,
  applyAutonomyHealthReviewActionsOperation,
} from "./action-operations.js";
import {
  type AutonomyHealthReviewActionResult,
  buildAutonomyHealthAttentionDigest,
  writeAutonomyHealthReviewArtifact,
} from "./health-review.js";
import { createHealthReviewTaskResolutionSteps } from "./health-review-task-resolution.js";
import {
  AUTONOMY_HEALTH_AUDIT_SCHEDULE_EVENT,
  buildReview,
  buildRuntimeAudit,
} from "./review-steps.js";

export { runtimeHealthAuditStepOutput } from "./review-steps.js";

type WorktreeInspection = {
  dirty: boolean;
};

const inspectWorktree = typedCodeStep<WorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  validate: (raw) => expectStructuredOutput<WorktreeInspection>(raw, ["dirty"]),
  run: async (ctx) => {
    const worktree = await ctx.runBlocking(repoWorktreeStatusOperation, {
      projectDir: ctx.projectDir,
    });
    return { dirty: worktree.available && worktree.dirty };
  },
});

const applyActions = typedCodeStep<ApplyHealthReviewActionsOutput>({
  id: "apply-actions",
  type: "code",
  when: (ctx) =>
    buildReview.output(ctx) !== undefined &&
    inspectWorktree.output(ctx)?.dirty === false,
  validate: (raw) =>
    expectStructuredOutput<ApplyHealthReviewActionsOutput>(raw, ["actions"]),
  run: async (ctx) => {
    const review = buildReview.outputRequired(ctx).review;
    const output = await ctx.runBlocking(
      applyAutonomyHealthReviewActionsOperation,
      {
        projectDir: ctx.projectDir,
        review,
      },
    );
    for (const action of output.actions.applied) {
      if (action.kind !== "decision-requested") continue;
      ctx.emit(autonomyIssueDecisionRequested.name, {
        issueKey: action.issueKey,
        rootCauseKey: action.dedupeKey,
        semanticRevision: action.semanticRevision,
        transition: action.transition,
        observedAt: review.generatedAt,
      });
    }
    return output;
  },
});

const taskResolution = createHealthReviewTaskResolutionSteps(applyActions);

function emptyActions(): AutonomyHealthReviewActionResult {
  return {
    createdTaskIds: [],
    droppedTaskIds: [],
    ownerQuestionIds: [],
    dismissedOwnerQuestionIds: [],
    taskMutationPaths: [],
    issueTransitions: [],
    applied: [],
    touchedTaskQueue: false,
  };
}

const writeArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-artifact",
  type: "code",
  when: async (ctx) =>
    buildReview.output(ctx) !== undefined &&
    (await taskResolution.isDurable(ctx)),
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const review = buildReview.outputRequired(ctx).review;
    const actions = applyActions.output(ctx)?.actions ?? emptyActions();
    const path = writeAutonomyHealthReviewArtifact(ctx.workflow.runDirPath, {
      generatedAt: new Date().toISOString(),
      review,
      actions,
    });
    return { written: true, path };
  },
});

const writeRuntimeAuditArtifact = typedCodeStep<{
  written: boolean;
  path: string;
}>({
  id: "write-runtime-audit-artifact",
  type: "code",
  when: (ctx) => buildRuntimeAudit.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const path = buildRuntimeAudit.outputRequired(ctx).artifactPath;
    if (!existsSync(path)) {
      throw new Error(`runtime health audit artifact was not written: ${path}`);
    }
    return { written: true, path };
  },
});

const autonomyHealthReviewerWorkflow: WorkflowDefinitionInput = {
  name: "autonomy-health-reviewer",
  description:
    "Project typed autonomy health observations into durable issue transitions and request review only for undecided revisions.",
  recoveryCapable: true,
  triggers: [
    {
      event: AUTONOMY_HEALTH_AUDIT_SCHEDULE_EVENT,
      intervalMs: 6 * 60 * 60 * 1000,
      cooldownMs: 60 * 60 * 1000,
    },
    {
      event: autonomyHealthSignal.name,
      filter: { severity: "critical" },
    },
    {
      event: autonomyHealthSignal.name,
      filter: { severity: ["warning", "error"] },
      batch: {
        maxCount: 5,
        maxAgeMs: 60 * 60 * 1000,
        groupBy: ["scopeId", "labelsKey"],
        maxBufferSize: 20,
        overflow: "flush-oldest",
      },
    },
    { event: "runtime.recovered" },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: (ctx) =>
        ctx.runBlocking(resetWorktreeForRecoveryOperation, {
          projectDir: ctx.projectDir,
          workflowName: "autonomy-health-reviewer",
        }),
    },
    inspectWorktree,
    buildRuntimeAudit,
    buildReview,
    applyActions,
    ...taskResolution.steps,
    writeArtifact,
    writeRuntimeAuditArtifact,
    {
      id: "emit-attention",
      type: "emit",
      when: async (ctx) =>
        (applyActions.output(ctx)?.actions.applied.length ?? 0) > 0 &&
        (await taskResolution.isDurable(ctx)),
      event: "workflow.attention.digest",
      payload: (ctx) =>
        buildAutonomyHealthAttentionDigest({
          review: buildReview.outputRequired(ctx).review,
          actions: applyActions.output(ctx)?.actions ?? emptyActions(),
        }),
    },
  ],
};

export default autonomyHealthReviewerWorkflow;
