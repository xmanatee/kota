import { isDeepStrictEqual } from "node:util";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  decodeProgressReviewConsumptionState,
  PROGRESS_REVIEW_STATE_KEY,
  type ProgressReviewConsumptionState,
} from "#modules/autonomy/workflows/progress-reviewer/semantic-input.js";
import {
  decodeProgressReviewPublicationRequest,
  PROGRESS_REVIEW_PUBLICATION_REQUESTED_EVENT,
  PROGRESS_REVIEW_PUBLICATION_RESOURCE,
  type ProgressReviewPublicationRequest,
  publishProgressReview,
} from "#modules/autonomy/workflows/progress-reviewer/semantic-publication.js";

const inspectRequest = typedCodeStep<ProgressReviewPublicationRequest>({
  id: "inspect-request",
  type: "code",
  validate: (raw) => decodeProgressReviewPublicationRequest(raw as object),
  run: ({ trigger }) => decodeProgressReviewPublicationRequest(trigger.payload),
});

const workflow: WorkflowDefinitionInput = {
  name: "progress-review-publication",
  repository: "none",
  resources: () => [PROGRESS_REVIEW_PUBLICATION_RESOURCE],
  description:
    "Finalize progress-review owner effects and semantic state after integration.",
  triggers: [{ event: PROGRESS_REVIEW_PUBLICATION_REQUESTED_EVENT }],
  steps: [
    inspectRequest,
    {
      id: "publish-progress-review",
      type: "code",
      run: (ctx) => {
        const snapshot = ctx.state.read<ProgressReviewConsumptionState>(
          PROGRESS_REVIEW_STATE_KEY,
        );
        const currentState = decodeProgressReviewConsumptionState(
          snapshot.value,
          ctx.scopeDir,
        );
        if (currentState.scopeId !== deriveDirectoryScopeId(ctx.scopeDir)) {
          throw new Error("progress review publication state belongs to another scope");
        }
        const result = publishProgressReview({
          scopeDir: ctx.scopeDir,
          sourceRunId: inspectRequest.outputRequired(ctx).sourceRunId,
          currentState,
        });
        if (!isDeepStrictEqual(result.nextState, currentState)) {
          ctx.state.compareAndSet(
            PROGRESS_REVIEW_STATE_KEY,
            snapshot.revision,
            result.nextState,
          );
        }
        return { disposition: result.disposition };
      },
    },
  ],
};

export default workflow;
