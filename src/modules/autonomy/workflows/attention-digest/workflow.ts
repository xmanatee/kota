import { join } from "node:path";
import { runAttentionDigestStep } from "./step.js";
import type { WorkflowDefinitionInput } from "../../../../workflow/types.js";

const attentionDigestWorkflow: WorkflowDefinitionInput = {
  name: "attention-digest",
  description:
    "Periodically check for attention-worthy system conditions and send a Telegram digest when any are found.",
  triggers: [
    {
      event: "workflow.build.committed",
    },
    {
      event: "workflow.completed",
      filter: {
        workflow: ["builder", "explorer", "inbox-sorter"],
        status: ["failed", "interrupted"],
      },
    },
    {
      event: "workflow.cost.anomaly",
    },
    {
      event: "workflow.budget.exceeded",
    },
    {
      event: "runtime.recovered",
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
