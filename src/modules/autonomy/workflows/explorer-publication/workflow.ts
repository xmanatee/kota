import { typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  decodeExplorerPublicationRequest,
  EXPLORER_PUBLICATION_REQUESTED_EVENT,
  type ExplorerPublicationRequest,
  publishExplorerCompletion,
} from "#modules/autonomy/workflows/explorer/explorer-publication.js";
import {
  EXPLORER_STATE_KEY,
  type ExplorerState,
} from "#modules/autonomy/workflows/explorer/explorer-state.js";

const inspectRequest = typedCodeStep<ExplorerPublicationRequest>({
  id: "inspect-request",
  type: "code",
  validate: (raw) => decodeExplorerPublicationRequest(raw as object),
  run: ({ trigger }) => decodeExplorerPublicationRequest(trigger.payload),
});

const workflow: WorkflowDefinitionInput = {
  name: "explorer-publication",
  repository: "none",
  description: "Publish the explorer cooldown after its repository run integrates.",
  triggers: [{ event: EXPLORER_PUBLICATION_REQUESTED_EVENT }],
  steps: [
    inspectRequest,
    {
      id: "publish-exploration",
      type: "code",
      run: (ctx) => {
        const request = inspectRequest.outputRequired(ctx);
        const snapshot = ctx.state.read<ExplorerState>(EXPLORER_STATE_KEY);
        const nextState = publishExplorerCompletion({
          sourceRunId: request.sourceRunId,
          scopeDir: ctx.scopeDir,
        });
        if (nextState === null) return { published: false };
        ctx.state.compareAndSet(
          EXPLORER_STATE_KEY,
          snapshot.revision,
          nextState,
        );
        return {
          published: true,
        };
      },
    },
  ],
};

export default workflow;
