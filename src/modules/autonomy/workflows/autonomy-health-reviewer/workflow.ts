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
  type PlanHealthReviewActionsOutput,
  planAutonomyHealthReviewActionsOperation,
} from "./action-operations.js";
import {
  type AutonomyHealthReviewActionResult,
  writeAutonomyHealthReviewArtifact,
} from "./health-review.js";
import {
  AUTONOMY_HEALTH_REVIEW_PUBLICATION_REQUESTED_EVENT,
  autonomyHealthReviewPublicationKey,
} from "./health-review-publication.js";
import { buildReview } from "./review-steps.js";

const planActions = typedCodeStep<PlanHealthReviewActionsOutput>({
  id: "plan-actions",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<PlanHealthReviewActionsOutput>(raw, ["actions"]),
  run: async (ctx) => {
    const review = buildReview.outputRequired(ctx).review;
    const projection = decodeAutonomyIssueProjection(
      ctx.state.read<AutonomyIssueProjection>(
        AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      ).value,
    );
    const output = await ctx.runBlocking(
      planAutonomyHealthReviewActionsOperation,
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
    taskMutations: [],
    dismissedOwnerQuestionIds: [],
    issueTransitions: [],
    applied: [],
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
    const actions = planActions.output(ctx)?.actions ?? emptyActions();
    const path = writeAutonomyHealthReviewArtifact(ctx.workflow.runDirPath, {
      generatedAt: new Date().toISOString(),
      review,
      actions,
    });
    return { written: true, path };
  },
});

const autonomyHealthReviewerWorkflow: WorkflowDefinitionInput = {
  name: "autonomy-health-reviewer",
  repository: "read",
  description:
    "Project typed autonomy health observations into durable issue transitions and request review only for undecided revisions.",
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
  ],
  steps: [
    buildReview,
    planActions,
    writeArtifact,
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
