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
import {
  AUTONOMY_HEALTH_REVIEW_PUBLICATION_REQUESTED_EVENT,
  type AutonomyHealthReviewPublicationRequest,
  type AutonomyHealthReviewPublicationResult,
  decodeAutonomyHealthReviewPublicationRequest,
  planAutonomyHealthReviewPublication,
  publishAutonomyHealthReview,
} from "#modules/autonomy/workflows/autonomy-health-reviewer/health-review-publication.js";

const inspectRequest = typedCodeStep<AutonomyHealthReviewPublicationRequest>({
  id: "inspect-request",
  type: "code",
  validate: (raw) => decodeAutonomyHealthReviewPublicationRequest(raw as object),
  run: ({ trigger }) =>
    decodeAutonomyHealthReviewPublicationRequest(trigger.payload),
});

const publishReview = typedCodeStep<AutonomyHealthReviewPublicationResult>({
  id: "publish-health-review",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<AutonomyHealthReviewPublicationResult>(raw, [
      "published",
      "decisionRequests",
      "attentionDigest",
    ]),
  run: (ctx) => {
    const request = inspectRequest.outputRequired(ctx);
    const snapshot = ctx.state.read<AutonomyIssueProjection>(
      AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
    );
    const currentProjection = decodeAutonomyIssueProjection(snapshot.value);
    const plan = planAutonomyHealthReviewPublication({
      scopeDir: ctx.scopeDir,
      sourceRunId: request.sourceRunId,
      scopeId: request.scopeId,
      currentProjection,
    });
    const publication = publishAutonomyHealthReview({
      scopeDir: ctx.scopeDir,
      sourceRunId: request.sourceRunId,
      scopeId: request.scopeId,
      currentProjection,
      plan,
    });
    stageAutonomyIssueProjection({
      state: ctx.state,
      key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      revision: snapshot.revision,
      current: currentProjection,
      next: publication.nextProjection,
      emit: ctx.emit,
      stepId: "publish-health-review:materialize",
    });
    return publication.result;
  },
});

const workflow: WorkflowDefinitionInput = {
  name: "autonomy-health-review-publication",
  repository: "none",
  resources: () => [AUTONOMY_ISSUE_PROJECTION_RESOURCE],
  description:
    "Finalize autonomy health projection and notifications after integration.",
  triggers: [{ event: AUTONOMY_HEALTH_REVIEW_PUBLICATION_REQUESTED_EVENT }],
  steps: [
    inspectRequest,
    publishReview,
    {
      id: "emit-decision-requests",
      type: "code",
      run: (ctx) => {
        const requests = publishReview.outputRequired(ctx).decisionRequests;
        for (const [index, request] of requests.entries()) {
          ctx.emit(
            autonomyIssueDecisionRequested.name,
            {
              issueKey: request.issueKey,
              rootCauseKey: request.rootCauseKey,
              semanticRevision: request.semanticRevision,
              transition: request.transition,
              observedAt: request.observedAt,
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
      type: "emit",
      when: (ctx) => publishReview.outputRequired(ctx).attentionDigest !== null,
      event: "workflow.attention.digest",
      payload: (ctx) => {
        const digest = publishReview.outputRequired(ctx).attentionDigest;
        if (!digest) throw new Error("health publication attention digest is missing");
        return digest;
      },
    },
  ],
};

export default workflow;
