import { isDeepStrictEqual } from "node:util";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  decodeScopeImprovementPublicationRequest,
  publishScopeImprovement,
  SCOPE_IMPROVEMENT_PUBLICATION_REQUESTED_EVENT,
  SCOPE_IMPROVEMENT_PUBLICATION_RESOURCE,
  type ScopeImprovementPublicationRequest,
} from "#modules/autonomy/workflows/scope-improver/scope-improvement-publication.js";
import {
  decodeScopeImprovementState,
  SCOPE_IMPROVEMENT_STATE_KEY,
} from "#modules/autonomy/workflows/scope-improver/scope-improvement-state.js";
import type { ScopeImprovementState } from "#modules/autonomy/workflows/scope-improver/scope-improvement-types.js";

const inspectRequest = typedCodeStep<ScopeImprovementPublicationRequest>({
  id: "inspect-request",
  type: "code",
  validate: (raw) => decodeScopeImprovementPublicationRequest(raw as object),
  run: ({ trigger }) => decodeScopeImprovementPublicationRequest(trigger.payload),
});

const workflow: WorkflowDefinitionInput = {
  name: "scope-improvement-publication",
  repository: "none",
  resources: () => [SCOPE_IMPROVEMENT_PUBLICATION_RESOURCE],
  description:
    "Finalize scope-improvement owner effects and semantic state after integration.",
  triggers: [{ event: SCOPE_IMPROVEMENT_PUBLICATION_REQUESTED_EVENT }],
  steps: [
    inspectRequest,
    {
      id: "publish-scope-improvement",
      type: "code",
      run: (ctx) => {
        const snapshot = ctx.state.read<ScopeImprovementState>(
          SCOPE_IMPROVEMENT_STATE_KEY,
        );
        const currentState = decodeScopeImprovementState(
          snapshot.value,
          deriveDirectoryScopeId(ctx.scopeRoot),
        );
        const result = publishScopeImprovement({
          scopeRoot: ctx.scopeRoot,
          sourceRunId: inspectRequest.outputRequired(ctx).sourceRunId,
          currentState,
        });
        if (
          result.nextState !== null &&
          !isDeepStrictEqual(result.nextState, currentState)
        ) {
          ctx.state.compareAndSet(
            SCOPE_IMPROVEMENT_STATE_KEY,
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
