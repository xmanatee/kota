import { join } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import {
  AUTONOMY_ISSUE_PROJECTION_RESOURCE,
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
  decodeAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { stageAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection-publication.js";
import { autonomyHealthSignal } from "#modules/autonomy/health-signal.js";
import {
  ownerQuestionMutationKey,
  ownerQuestionMutationRequested,
} from "#modules/owner-questions/events.js";
import {
  type PlanHealthReviewActionsOutput,
  planAutonomyHealthReviewActionsOperation,
} from "./action-operations.js";
import {
  type AutonomyHealthReviewActionResult,
  applyAutonomyHealthReviewActions,
  buildAutonomyHealthAttentionDigest,
  writeAutonomyHealthReviewArtifact,
} from "./health-review.js";
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
        workspaceRoot: ctx.workspaceRoot,
        currentProjection: projection,
        review,
      },
    );
    return output;
  },
});

type PublishedReview = { actions: AutonomyHealthReviewActionResult };

const publishReview = typedCodeStep<PublishedReview>({
  id: "publish-review",
  type: "code",
  validate: (raw) => expectStructuredOutput<PublishedReview>(raw, ["actions"]),
  run: (ctx) => {
    const review = buildReview.outputRequired(ctx).review;
    const snapshot = ctx.state.read<AutonomyIssueProjection>(
      AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
    );
    const currentProjection = decodeAutonomyIssueProjection(snapshot.value);
    const finalized = applyAutonomyHealthReviewActions({
      currentProjection,
      ownerQuestionQueue: new OwnerQuestionQueue(
        join(ctx.scopeRoot, ".kota", "owner-questions"),
      ),
      review,
      plannedActions: planActions.outputRequired(ctx).actions,
    });
    const { projection, ...actions } = finalized;
    stageAutonomyIssueProjection({
      state: ctx.state,
      key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      revision: snapshot.revision,
      current: currentProjection,
      next: projection,
      emit: ctx.emit,
      stepId: "publish-review:materialize",
    });
    return { actions };
  },
});

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
    const actions = publishReview.outputRequired(ctx).actions;
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
  resources: () => [AUTONOMY_ISSUE_PROJECTION_RESOURCE],
  description:
    "Turn typed autonomy health observations into durable issue transitions and request review only for undecided revisions.",
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
    publishReview,
    writeArtifact,
    {
      id: "emit-task-mutations",
      type: "code",
      run: (ctx) => {
        const mutations = publishReview.outputRequired(ctx).actions.taskMutations;
        for (const [index, mutation] of mutations.entries()) {
          ctx.emit(
            "repo-task.mutation.requested",
            { request: { kind: "move", ...mutation } },
            {
              delivery: "on-run-success",
              stepId: `emit-task-mutation:${mutation.id}:${mutation.state}:${index}`,
            },
          );
        }
        return { emitted: mutations.length };
      },
    },
    {
      id: "emit-owner-question-mutations",
      type: "code",
      run: (ctx) => {
        const questionIds = publishReview.outputRequired(ctx).actions
          .dismissedOwnerQuestionIds;
        for (const questionId of questionIds) {
          ctx.emit(
            ownerQuestionMutationRequested.name,
            {
              questionId,
              mutation: "dismiss",
              reason: "Resolved by an explicit autonomy issue clear observation",
              resolutionSource: "autonomy-health-reviewer",
              idempotencyKey: ownerQuestionMutationKey(questionId),
            },
            {
              delivery: "on-run-success",
              stepId: `emit-owner-question-mutation:${questionId}`,
            },
          );
        }
        return { emitted: questionIds.length };
      },
    },
    {
      id: "emit-decision-requests",
      type: "code",
      run: (ctx) => {
        const review = buildReview.outputRequired(ctx).review;
        const requests = publishReview.outputRequired(ctx).actions.applied.filter(
          (action) => action.kind === "decision-requested",
        );
        for (const [index, request] of requests.entries()) {
          ctx.emit(
            autonomyIssueDecisionRequested.name,
            {
              issueKey: request.issueKey,
              rootCauseKey: request.dedupeKey,
              semanticRevision: request.semanticRevision,
              transition: request.transition,
              observedAt: review.generatedAt,
            },
            {
              delivery: "on-run-success",
              stepId:
                `emit-decision-request:${request.issueKey}:` +
                `${request.semanticRevision}:${index}`,
            },
          );
        }
        return { emitted: requests.length };
      },
    },
    {
      id: "emit-attention",
      type: "code",
      run: (ctx) => {
        const actions = publishReview.outputRequired(ctx).actions;
        if (actions.applied.length === 0) return { emitted: 0 };
        ctx.emit(
          "workflow.attention.digest",
          buildAutonomyHealthAttentionDigest({
            review: buildReview.outputRequired(ctx).review,
            actions,
          }),
          {
            delivery: "on-run-success",
            stepId: "emit-attention",
          },
        );
        return { emitted: 1 };
      },
    },
  ],
};

export default autonomyHealthReviewerWorkflow;
