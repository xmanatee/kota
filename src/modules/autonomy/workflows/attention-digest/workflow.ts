import { join } from "node:path";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  ATTENTION_DIGEST_STATE_KEY,
  type AttentionItem,
  attentionDigestStepOperation,
} from "./step.js";

const attentionDigestWorkflow: WorkflowDefinitionInput = {
  name: "attention-digest",
  description:
    "Report new or changed attention-worthy system conditions without repeating unchanged alerts.",
  repository: "read",
  resources: () => [ATTENTION_DIGEST_STATE_KEY],
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        tags: ["monitored"],
        status: ["success", "completed-with-warnings", "failed", "interrupted"],
      },
    },
  ],
  steps: [
    {
      id: "digest",
      type: "code",
      run: async ({ scopeRoot, stateDir, runtimeStateDir, state, emit, runBlocking }) => {
        const previous = state.read<AttentionItem[]>(ATTENTION_DIGEST_STATE_KEY);
        const result = await runBlocking(attentionDigestStepOperation, {
          scopeRoot,
          runtimeStateDir,
          runsDir: join(stateDir, "runs"),
          previousItems: previous.value ?? [],
        });
        if (result === null) return;
        state.compareAndSet(ATTENTION_DIGEST_STATE_KEY, previous.revision, result.items);
        if (result.event) {
          emit(result.event.name, result.event.payload, {
            delivery: "on-run-success",
            stepId: "digest",
          });
        }
      },
    },
  ],
};

export default attentionDigestWorkflow;
