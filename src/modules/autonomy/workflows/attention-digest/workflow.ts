import { join } from "node:path";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  onRecoveryTrigger,
  resetWorktreeForRecoveryOperation,
} from "#modules/autonomy/recovery.js";
import { attentionDigestStepOperation } from "./step.js";

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
      run: (ctx) =>
        ctx.runBlocking(resetWorktreeForRecoveryOperation, {
          projectDir: ctx.projectDir,
          workflowName: "attention-digest",
        }),
    },
    {
      id: "digest",
      type: "code",
      run: async ({ projectDir, emit, runBlocking }) => {
        const runsDir = join(projectDir, ".kota", "runs");
        const result = await runBlocking(attentionDigestStepOperation, {
          projectDir,
          runsDir,
        });
        if (result.event) emit(result.event.name, result.event.payload);
      },
    },
  ],
};

export default attentionDigestWorkflow;
