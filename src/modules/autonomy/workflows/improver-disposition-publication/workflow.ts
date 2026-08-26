import { typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  AUTONOMY_ISSUE_PROJECTION_RESOURCE,
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
  decodeAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { stageAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection-publication.js";
import {
  decodeImproverDispositionPublicationRequest,
  IMPROVER_DISPOSITION_PUBLICATION_REQUESTED_EVENT,
  type ImproverDispositionPublicationRequest,
  publishImproverDisposition,
} from "#modules/autonomy/workflows/improver/disposition-publication.js";

const inspectRequest = typedCodeStep<ImproverDispositionPublicationRequest>({
  id: "inspect-request",
  type: "code",
  validate: (raw) => decodeImproverDispositionPublicationRequest(raw as object),
  run: ({ trigger }) =>
    decodeImproverDispositionPublicationRequest(trigger.payload),
});

const workflow: WorkflowDefinitionInput = {
  name: "improver-disposition-publication",
  repository: "none",
  resources: () => [AUTONOMY_ISSUE_PROJECTION_RESOURCE],
  description: "Finalize an improver disposition after repository integration.",
  triggers: [{ event: IMPROVER_DISPOSITION_PUBLICATION_REQUESTED_EVENT }],
  steps: [
    inspectRequest,
    {
      id: "publish-disposition",
      type: "code",
      run: (ctx) => {
        const request = inspectRequest.outputRequired(ctx);
        const snapshot = ctx.state.read<AutonomyIssueProjection>(
          AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
        );
        const currentProjection = decodeAutonomyIssueProjection(snapshot.value);
        const publication = publishImproverDisposition({
          scopeRoot: ctx.scopeRoot,
          sourceRunId: request.sourceRunId,
          currentProjection,
        });
        stageAutonomyIssueProjection({
          state: ctx.state,
          key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
          revision: snapshot.revision,
          current: currentProjection,
          next: publication.nextProjection,
          emit: ctx.emit,
          stepId: "publish-disposition:materialize",
        });
        return { published: publication.published };
      },
    },
  ],
};

export default workflow;
