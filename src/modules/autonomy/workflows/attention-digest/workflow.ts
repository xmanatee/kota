import { join } from "node:path";
import { runAttentionDigestStep } from "../../workflow/attention-digest.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";

const attentionDigestWorkflow: WorkflowDefinitionInput = {
  name: "attention-digest",
  description:
    "Periodically check for attention-worthy system conditions and send a Telegram digest when any are found.",
  tags: ["observer"],
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        workflowTags: "attention-source",
      },
    },
  ],
  steps: [
    {
      id: "digest",
      type: "code",
      run: ({ projectDir, emit }) => {
        const runsDir = join(projectDir, ".kota", "runs");
        runAttentionDigestStep(projectDir, runsDir, undefined, emit);
      },
    },
  ],
};

export default attentionDigestWorkflow;
