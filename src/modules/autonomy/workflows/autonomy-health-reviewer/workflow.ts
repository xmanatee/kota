import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { checkCommitStageable, commitWorkflowChanges } from "#modules/autonomy/commit.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import {
  onNormalTrigger,
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import {
  checkCommitMessageExists,
  checkNoScratchArtifacts,
  runCheck,
  stepCommitted,
} from "#modules/autonomy/shared.js";
import {
  type AutonomyHealthReview,
  type AutonomyHealthReviewActionResult,
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthAttentionDigest,
  buildAutonomyHealthReview,
  writeAutonomyHealthReviewArtifact,
} from "./health-review.js";

type WorktreeInspection = {
  dirty: boolean;
};

type ReviewOutput = {
  review: AutonomyHealthReview;
};

type ActionOutput = {
  actions: AutonomyHealthReviewActionResult;
};

const inspectWorktree = typedCodeStep<WorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) => expectStructuredOutput<WorktreeInspection>(raw, ["dirty"]),
  run: ({ projectDir }) => {
    const worktree = getRepoWorktreeStatus(projectDir);
    return { dirty: worktree.available && worktree.trackedDirty };
  },
});

const buildReview = typedCodeStep<ReviewOutput>({
  id: "build-review",
  type: "code",
  when: onNormalTrigger,
  validate: (raw) => expectStructuredOutput<ReviewOutput>(raw, ["review"]),
  run: (ctx) => ({
    review: buildAutonomyHealthReview({
      triggerPayload: ctx.trigger.payload,
      generatedAt: new Date().toISOString(),
    }),
  }),
});

const applyActions = typedCodeStep<ActionOutput>({
  id: "apply-actions",
  type: "code",
  when: (ctx) =>
    buildReview.output(ctx) !== undefined &&
    inspectWorktree.output(ctx)?.dirty === false,
  validate: (raw) => expectStructuredOutput<ActionOutput>(raw, ["actions"]),
  run: (ctx) => ({
    actions: applyAutonomyHealthReviewActions({
      projectDir: ctx.projectDir,
      runId: ctx.workflow.runId,
      review: buildReview.outputRequired(ctx).review,
      nowIso: new Date().toISOString(),
    }),
  }),
});

function emptyActions(): AutonomyHealthReviewActionResult {
  return {
    createdTaskIds: [],
    ownerQuestionIds: [],
    applied: [],
    touchedTaskQueue: false,
  };
}

const writeArtifact = typedCodeStep<{ written: boolean; path: string }>({
  id: "write-artifact",
  type: "code",
  when: (ctx) => buildReview.output(ctx) !== undefined,
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

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => applyActions.output(ctx)?.actions.touchedTaskQueue === true,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: (ctx) => {
    const actions = applyActions.outputRequired(ctx).actions;
    const taskActions = actions.applied.filter(
      (action) => action.kind === "created-task" || action.kind === "refreshed-task",
    );
    const lines = [
      `autonomy-health-reviewer: route ${taskActions.length} health repair task(s)`,
      "",
      ...taskActions.map((action) =>
        action.kind === "created-task"
          ? `- create ${action.taskId}`
          : `- refresh ${action.taskId}`,
      ),
    ];
    mkdirSync(ctx.workflow.runDirPath, { recursive: true });
    writeFileSync(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `${lines.join("\n")}\n`,
      "utf-8",
    );
    return { written: true };
  },
});

const validateBeforeCommit = typedCodeStep<{ ok: true }>({
  id: "validate-before-commit",
  type: "code",
  when: (ctx) => writeCommitMessage.output(ctx)?.written === true,
  validate: (raw) => {
    const obj = expectStructuredOutput<{ ok: true }>(raw, ["ok"]);
    if (obj.ok !== true) throw new Error(`expected ok: true, got ${String(obj.ok)}`);
    return obj;
  },
  run: (ctx) => {
    runCheck("pnpm run validate-tasks", ctx.projectDir);
    checkNoScratchArtifacts(ctx.projectDir);
    checkCommitStageable(ctx.projectDir);
    checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir);
    return { ok: true } as const;
  },
});

const commitChanges = typedCodeStep<{ committed: boolean }>({
  id: "commit",
  type: "code",
  when: (ctx) => validateBeforeCommit.output(ctx)?.ok === true,
  validate: (raw) =>
    expectStructuredOutput<{ committed: boolean }>(raw, ["committed"]),
  run: ({ projectDir, workflow }) => {
    const result = commitWorkflowChanges(projectDir, workflow.runDirPath);
    return { committed: Boolean(result.committed) };
  },
});

const autonomyHealthReviewerWorkflow: WorkflowDefinitionInput = {
  name: "autonomy-health-reviewer",
  description:
    "Batch typed autonomy health signals into deduped review artifacts, repair tasks, owner questions, and attention items.",
  recoveryCapable: true,
  triggers: [
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
    {
      event: "runtime.recovered",
    },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({
          projectDir,
          workflowName: "autonomy-health-reviewer",
        }),
    },
    inspectWorktree,
    buildReview,
    applyActions,
    writeArtifact,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
    {
      id: "emit-attention",
      type: "emit",
      when: (ctx) => writeArtifact.output(ctx)?.written === true,
      event: "workflow.attention.digest",
      payload: (ctx) =>
        buildAutonomyHealthAttentionDigest({
          review: buildReview.outputRequired(ctx).review,
          actions: applyActions.output(ctx)?.actions ?? emptyActions(),
        }),
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "autonomy-health-reviewer committed health repair task changes",
      requires: ["commit"],
    },
  ],
};

export default autonomyHealthReviewerWorkflow;
