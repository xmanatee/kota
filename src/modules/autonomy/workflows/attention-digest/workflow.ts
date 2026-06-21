import { join } from "node:path";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecovery,
} from "#modules/autonomy/recovery.js";
import { runAttentionDigestStep } from "./step.js";

const attentionDigestWorkflow: WorkflowDefinitionInput = {
  name: "attention-digest",
  description:
    "Check for attention-worthy system conditions and emit a notification digest when any are found.",
  recoveryCapable: true,
  triggers: [
    {
      event: "workflow.build.committed",
    },
    {
      event: "workflow.completed",
      filter: {
        tags: ["monitored"],
        status: ["failed", "interrupted"],
      },
    },
    {
      event: "runtime.recovered",
    },
  ],
  steps: [
    {
      id: "reset-for-recovery",
      type: "code",
      when: onRecoveryTrigger,
      run: ({ projectDir }) =>
        resetWorktreeForRecovery({ projectDir, workflowName: "attention-digest" }),
    },
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
