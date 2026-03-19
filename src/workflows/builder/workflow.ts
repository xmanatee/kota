import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import {
  BUILTIN_WORKFLOW_MODEL,
  createVerificationAndRestartSteps,
} from "../shared.js";

const builderWorkflow: WorkflowDefinitionInput = {
  name: "builder",
  description: "Build KOTA by shipping one cohesive improvement per workflow run.",
  triggers: [
    {
      event: "runtime.idle",
      cooldownMs: 30_000,
    },
  ],
  steps: [
    {
      id: "build",
      type: "agent",
      promptPath: "src/workflows/builder/prompt.md",
      model: BUILTIN_WORKFLOW_MODEL,
      permissionMode: "bypassPermissions",
      settingSources: ["project"],
    },
    ...createVerificationAndRestartSteps(
      "builder workflow finished verification build",
    ),
  ],
};

export default builderWorkflow;
