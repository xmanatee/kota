import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import {
  BUILTIN_WORKFLOW_MODEL,
  createVerificationAndRestartSteps,
} from "../shared.js";
import { gatherImproverContext } from "./gather-context.js";
import { recoverDoingTasks } from "./recover-doing-tasks.js";

const improverWorkflow: WorkflowDefinitionInput = {
  name: "improver",
  description:
    "Improve the autonomous development system itself using evidence from recent runs.",
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        workflow: "builder",
        status: ["success", "failed"],
      },
    },
    {
      event: "workflow.completed",
      filter: {
        workflow: "explorer",
        status: "failed",
      },
    },
  ],
  steps: [
    {
      id: "gather-context",
      type: "code",
      run: (ctx) => gatherImproverContext(ctx),
    },
    {
      id: "recover-doing-tasks",
      type: "code",
      run: (ctx) => recoverDoingTasks(ctx),
    },
    {
      id: "improve",
      type: "agent",
      promptPath: "src/workflows/improver/prompt.md",
      model: BUILTIN_WORKFLOW_MODEL,
      permissionMode: "bypassPermissions",
      settingSources: ["project"],
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
    },
    ...createVerificationAndRestartSteps(
      "improver workflow finished verification build",
      "improve",
    ),
  ],
};

export default improverWorkflow;
