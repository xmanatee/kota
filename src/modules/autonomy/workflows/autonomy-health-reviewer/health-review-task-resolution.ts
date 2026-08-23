import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type {
  WorkflowCommitPathPolicy,
} from "#modules/autonomy/commit.js";
import {
  decodeWorkflowCommitOutcome,
  type WorkflowCommitOutcome,
} from "#modules/autonomy/commit-result.js";
import {
  runCheck,
  stepCommitted,
  stepSucceeded,
} from "#modules/autonomy/shared.js";
import {
  workflowCommitOperation,
  workflowCommitValidationOperation,
} from "#modules/autonomy/workflow-commit-operations.js";
import type { AutonomyHealthReviewActionResult } from "./health-review.js";

type ActionOutput = { actions: AutonomyHealthReviewActionResult };

type ActionOutputReader = {
  output(ctx: WorkflowStepContext): ActionOutput | undefined;
  outputRequired(ctx: WorkflowStepContext): ActionOutput;
};

function taskCommitPolicy(
  actions: AutonomyHealthReviewActionResult,
): WorkflowCommitPathPolicy {
  return { kind: "exact-paths", paths: actions.taskMutationPaths };
}

export function createHealthReviewTaskResolutionSteps(
  applyActions: ActionOutputReader,
) {
  const writeCommitMessage = typedCodeStep<{ written: true }>({
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

  return {
    steps: [writeCommitMessage, validateTaskMutation, commitTaskMutation],
    isDurable: async (ctx: WorkflowStepContext): Promise<boolean> => {
      const actions = applyActions.output(ctx)?.actions;
      return !actions ||
        actions.taskMutationPaths.length === 0 ||
        await stepCommitted("commit-task-mutation")(ctx);
    },
  };
}
