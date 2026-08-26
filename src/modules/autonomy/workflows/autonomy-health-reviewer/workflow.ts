import { existsSync } from "node:fs";
import { repoWorktreeStatusOperation } from "#core/util/repo-worktree-operation.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
  decodeAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import {
  type StageHealthReviewActionsOutput,
  stageAutonomyHealthReviewActionsOperation,
} from "./action-operations.js";
import {
  type AutonomyHealthReviewActionResult,
  writeAutonomyHealthReviewArtifact,
} from "./health-review.js";
import {
  AUTONOMY_HEALTH_REVIEW_PUBLICATION_REQUESTED_EVENT,
  autonomyHealthReviewPublicationKey,
} from "./health-review-publication.js";
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

const stageActions = typedCodeStep<StageHealthReviewActionsOutput>({
  id: "stage-actions",
  type: "code",
  when: (ctx) =>
    buildReview.output(ctx) !== undefined &&
    inspectWorktree.output(ctx)?.dirty === false,
  validate: (raw) =>
    expectStructuredOutput<StageHealthReviewActionsOutput>(raw, ["actions"]),
  run: async (ctx) => {
    const review = buildReview.outputRequired(ctx).review;
    const projection = decodeAutonomyIssueProjection(
      ctx.state.read<AutonomyIssueProjection>(
        AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      ).value,
    );
    const output = await ctx.runBlocking(
      stageAutonomyHealthReviewActionsOperation,
      {
        projectDir: ctx.projectDir,
        currentProjection: projection,
        review,
      },
    );
    return output;
  },
});

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
  when: (ctx) => buildReview.output(ctx) !== undefined,
  validate: (raw) =>
    expectStructuredOutput<{ written: boolean; path: string }>(raw, [
      "written",
      "path",
    ]),
  run: (ctx) => {
    const review = buildReview.outputRequired(ctx).review;
    const actions = stageActions.output(ctx)?.actions ?? emptyActions();
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
  repository: "write",
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  description:
    "Project typed autonomy health observations into durable issue transitions and request review only for undecided revisions.",
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
  ],
  steps: [
    inspectWorktree,
    buildRuntimeAudit,
    buildReview,
    stageActions,
    writeArtifact,
    writeRuntimeAuditArtifact,
    {
      id: "emit-health-review-publication",
      type: "emit",
      when: (ctx) => writeArtifact.output(ctx)?.written === true,
      event: AUTONOMY_HEALTH_REVIEW_PUBLICATION_REQUESTED_EVENT,
      payload: (ctx) => {
        const publicationKey = autonomyHealthReviewPublicationKey(
          ctx.workflow.runId,
        );
        return {
          idempotencyKey: publicationKey,
          publicationKey,
          sourceRunId: ctx.workflow.runId,
        };
      },
    },
  ],
};

export default autonomyHealthReviewerWorkflow;
