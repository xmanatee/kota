import { join } from "node:path";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  ATTENTION_DIGEST_COUNTER_STATE_KEY,
  attentionDigestStepOperation,
} from "./step.js";

const attentionDigestWorkflow: WorkflowDefinitionInput = {
  name: "attention-digest",
  description:
    "Check for attention-worthy system conditions and emit a notification digest when any are found.",
  repository: "read",
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
      run: async ({ workspaceRoot, stateDir, state, emit, runBlocking }) => {
        const counter = state.read<{ count: number }>(
          ATTENTION_DIGEST_COUNTER_STATE_KEY,
        );
        const count = (counter.value?.count ?? 0) + 1;
        state.compareAndSet(
          ATTENTION_DIGEST_COUNTER_STATE_KEY,
          counter.revision,
          { count },
        );
        const result = await runBlocking(attentionDigestStepOperation, {
          workspaceRoot,
          runsDir: join(stateDir, "runs"),
          count,
        });
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
