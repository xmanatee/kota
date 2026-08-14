import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoWorktreeStatusAsync } from "#core/util/repo-worktree.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  decodeWorkflowCommitOutcome,
  type WorkflowCommitOutcome,
} from "#modules/autonomy/commit-result.js";
import {
  autonomyHealthSignal,
} from "#modules/autonomy/health-signal.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import { runCheck, stepCommitRequiresDaemonRestart } from "#modules/autonomy/shared.js";
import {
  workflowCommitOperation,
  workflowCommitValidationOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import {
  type ApplyAutonomyHealthReviewActionsOutput,
  applyAutonomyHealthReviewActionsOperation,
} from "./action-operations.js";
import {
  type AutonomyHealthReviewActionResult,
  buildAutonomyHealthAttentionDigest,
  writeAutonomyHealthReviewArtifact,
} from "./health-review.js";
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
  run: async ({ projectDir }) => {
    const worktree = await getRepoWorktreeStatusAsync(projectDir);
    return { dirty: worktree.available && worktree.dirty };
  },
});

const applyActions = typedCodeStep<ApplyAutonomyHealthReviewActionsOutput>({
  id: "apply-actions",
  type: "code",
  when: (ctx) =>
    buildReview.output(ctx) !== undefined &&
    inspectWorktree.output(ctx)?.dirty === false,
  validate: (raw) =>
    expectStructuredOutput<ApplyAutonomyHealthReviewActionsOutput>(raw, [
      "actions",
      "ownerQuestionEvents",
    ]),
  run: async (ctx) => {
    const output = await ctx.runBlocking(applyAutonomyHealthReviewActionsOperation, {
      projectDir: ctx.projectDir,
      runId: ctx.workflow.runId,
      review: buildReview.outputRequired(ctx).review,
      nowIso: new Date().toISOString(),
    });
    for (const payload of output.ownerQuestionEvents) {
      ctx.emit("owner.question.asked", payload);
    }
    return output;
  },
});

function emptyActions(): AutonomyHealthReviewActionResult {
  return {
    createdTaskIds: [],
    ownerQuestionIds: [],
    dismissedOwnerQuestionIds: [],
    issueTransitions: [],
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

const writeRuntimeAuditArtifact = typedCodeStep<{ written: boolean; path: string }>({
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
  run: async (ctx) => {
    await runCheck("pnpm run validate-tasks", ctx.projectDir, { signal: ctx.signal });
    await ctx.runBlocking(workflowCommitValidationOperation, {
      projectDir: ctx.projectDir,
      runDirPath: ctx.workflow.runDirPath,
    });
    return { ok: true } as const;
  },
});

const commitChanges = typedCodeStep<WorkflowCommitOutcome>({
  id: "commit",
  type: "code",
  when: (ctx) => validateBeforeCommit.output(ctx)?.ok === true,
  validate: decodeWorkflowCommitOutcome,
  run: (ctx) =>
    ctx.runBlocking(workflowCommitOperation, {
      projectDir: ctx.projectDir,
      runDirPath: ctx.workflow.runDirPath,
    }),
});

const autonomyHealthReviewerWorkflow: WorkflowDefinitionInput = {
  name: "autonomy-health-reviewer",
  description:
    "Batch typed autonomy health signals and persisted runtime evidence into deduped review artifacts, repair tasks, owner questions, and attention items.",
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
    {
      event: "runtime.recovered",
    },
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
    writeArtifact,
    writeRuntimeAuditArtifact,
    writeCommitMessage,
    validateBeforeCommit,
    commitChanges,
    {
      id: "emit-attention",
      type: "emit",
      when: (ctx) => (buildReview.output(ctx)?.review.groups.length ?? 0) > 0,
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
      when: stepCommitRequiresDaemonRestart("commit"),
      reason: "autonomy-health-reviewer committed health repair task changes",
      requires: ["commit"],
    },
  ],
};

export default autonomyHealthReviewerWorkflow;
