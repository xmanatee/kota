import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getRepoWorktreeStatusAsync } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import type { WorkflowCommitPathPolicy } from "#modules/autonomy/commit.js";
import {
  decodeWorkflowCommitOutcome,
  type WorkflowCommitOutcome,
} from "#modules/autonomy/commit-result.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import {
  runCheck,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  workflowCommitOperation,
  workflowCommitValidationOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import {
  type AutonomyHealthReviewActionResult,
  applyAutonomyHealthReviewActions,
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

type ApplyActionsInput = {
  projectDir: string;
  review: Parameters<typeof applyAutonomyHealthReviewActions>[0]["review"];
};

type ApplyActionsOutput = {
  actions: AutonomyHealthReviewActionResult;
};

export function applyAutonomyHealthReviewActionsInWorker(
  input: ApplyActionsInput,
): ApplyActionsOutput {
  return {
    actions: applyAutonomyHealthReviewActions(input),
  };
}

const applyAutonomyHealthReviewActionsOperation =
  defineWorkflowBlockingOperation<ApplyActionsInput, ApplyActionsOutput>(
    import.meta.url,
    "applyAutonomyHealthReviewActionsInWorker",
  );

const inspectWorktree = typedCodeStep<WorktreeInspection>({
  id: "inspect-worktree",
  type: "code",
  validate: (raw) => expectStructuredOutput<WorktreeInspection>(raw, ["dirty"]),
  run: async ({ projectDir }) => {
    const worktree = await getRepoWorktreeStatusAsync(projectDir);
    return { dirty: worktree.available && worktree.dirty };
  },
});

const applyActions = typedCodeStep<ApplyActionsOutput>({
  id: "apply-actions",
  type: "code",
  when: (ctx) =>
    buildReview.output(ctx) !== undefined &&
    inspectWorktree.output(ctx)?.dirty === false,
  validate: (raw) =>
    expectStructuredOutput<ApplyActionsOutput>(raw, ["actions"]),
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

function taskCommitPolicy(
  actions: AutonomyHealthReviewActionResult,
): WorkflowCommitPathPolicy {
  return { kind: "exact-paths", paths: actions.taskMutationPaths };
}

const writeTaskCommitMessage = typedCodeStep<{ written: true }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) =>
    (applyActions.output(ctx)?.actions.taskMutationPaths.length ?? 0) > 0,
  validate: (raw) =>
    expectStructuredOutput<{ written: true }>(raw, ["written"]),
  run: async (ctx) => {
    await mkdir(ctx.workflow.runDirPath, { recursive: true });
    await writeFile(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      "autonomy: resolve cleared issue generated work\n",
      "utf-8",
    );
    return { written: true } as const;
  },
});

const validateTaskMutation = typedCodeStep<{ ok: true }>({
  id: "validate-task-mutation",
  type: "code",
  when: stepSucceeded("write-commit-message"),
  validate: (raw) => expectStructuredOutput<{ ok: true }>(raw, ["ok"]),
  run: async (ctx) => {
    const actions = applyActions.outputRequired(ctx).actions;
    await runCheck("pnpm run validate-tasks", ctx.projectDir, {
      signal: ctx.signal,
    });
    await ctx.runBlocking(workflowCommitValidationOperation, {
      projectDir: ctx.projectDir,
      runDirPath: ctx.workflow.runDirPath,
      policy: taskCommitPolicy(actions),
    });
    return { ok: true } as const;
  },
});

const commitTaskMutation = typedCodeStep<WorkflowCommitOutcome>({
  id: "commit-task-mutation",
  type: "code",
  when: stepSucceeded("validate-task-mutation"),
  validate: decodeWorkflowCommitOutcome,
  run: (ctx) =>
    ctx.runBlocking(workflowCommitOperation, {
      projectDir: ctx.projectDir,
      runDirPath: ctx.workflow.runDirPath,
      policy: taskCommitPolicy(applyActions.outputRequired(ctx).actions),
    }),
});

const taskResolution = {
  steps: [writeTaskCommitMessage, validateTaskMutation, commitTaskMutation],
  isDurable: async (ctx: WorkflowStepContext): Promise<boolean> => {
    const actions = applyActions.output(ctx)?.actions;
    return (
      !actions ||
      actions.taskMutationPaths.length === 0 ||
      (await stepCommitted("commit-task-mutation")(ctx))
    );
  },
};

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
