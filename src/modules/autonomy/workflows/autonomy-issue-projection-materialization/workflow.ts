import { typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  AUTONOMY_ISSUE_PROJECTION_RESOURCE,
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
  decodeAutonomyIssueProjection,
  materializeAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import {
  AUTONOMY_ISSUE_PROJECTION_MATERIALIZATION_REQUESTED_EVENT,
  type AutonomyIssueProjectionMaterializationRequest,
  decodeAutonomyIssueProjectionMaterializationRequest,
} from "#modules/autonomy/autonomy-issue-projection-publication.js";

const inspectRequest = typedCodeStep<AutonomyIssueProjectionMaterializationRequest>({
  id: "inspect-request",
  type: "code",
  validate: (raw) =>
    decodeAutonomyIssueProjectionMaterializationRequest(raw as object),
  run: ({ trigger }) =>
    decodeAutonomyIssueProjectionMaterializationRequest(trigger.payload),
});

const workflow: WorkflowDefinitionInput = {
  name: "autonomy-issue-projection-materialization",
  repository: "none",
  resources: () => [AUTONOMY_ISSUE_PROJECTION_RESOURCE],
  description:
    "Materialize the published autonomy issue state for non-workflow readers.",
  triggers: [{ event: AUTONOMY_ISSUE_PROJECTION_MATERIALIZATION_REQUESTED_EVENT }],
  steps: [
    inspectRequest,
    {
      id: "materialize-projection",
      type: "code",
      run: (ctx) => {
        const requested = inspectRequest.outputRequired(ctx).stateRevision;
        const snapshot = ctx.state.read<AutonomyIssueProjection>(
          AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
        );
        if (snapshot.revision < requested) {
          throw new Error("autonomy issue projection state publication is not visible");
        }
        materializeAutonomyIssueProjection(
          ctx.scopeDir,
          decodeAutonomyIssueProjection(snapshot.value),
        );
        return { materializedRevision: snapshot.revision };
      },
    },
  ],
};

export default workflow;
