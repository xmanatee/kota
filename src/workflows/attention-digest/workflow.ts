import { join } from "node:path";
import { runAttentionDigestStep } from "../../workflow/attention-digest.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";

const attentionDigestWorkflow: WorkflowDefinitionInput = {
  name: "attention-digest",
  description:
    "Periodically check for attention-worthy system conditions and send a Telegram digest when any are found.",
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        workflow: ["explorer", "builder", "improver"],
      },
    },
  ],
  steps: [
    {
      id: "digest",
      type: "code",
      run: ({ projectDir }) => {
        const runsDir = join(projectDir, ".kota", "runs");
        runAttentionDigestStep(projectDir, runsDir);
      },
    },
  ],
};

export default attentionDigestWorkflow;
