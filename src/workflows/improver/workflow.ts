import type { WorkflowDefinitionInput } from "../../workflow/types.js";

const RESTART_VERIFICATION_STEP_IDS = [
  "verify-typecheck",
  "verify-workflow-critical",
  "verify-build",
] as const;

const improverWorkflow: WorkflowDefinitionInput = {
  name: "improver",
  description: "Improve the autonomous development system itself using evidence from recent runs.",
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        workflow: "builder",
        status: ["success", "failed"],
      },
    },
  ],
  steps: [
    {
      id: "improve",
      type: "agent",
      promptPath: "src/workflows/improver/prompt.md",
      model: "claude-sonnet-4-6",
      permissionMode: "bypassPermissions",
      settingSources: ["project"],
    },
    {
      id: "verify-typecheck",
      type: "tool",
      tool: "shell",
      input: {
        command: "npm run typecheck",
        stream_output: false,
      },
    },
    {
      id: "verify-workflow-critical",
      type: "tool",
      tool: "shell",
      input: {
        command: "npm run test:workflow-critical",
        stream_output: false,
      },
    },
    {
      id: "verify-build",
      type: "tool",
      tool: "shell",
      input: {
        command: "npm run build",
        stream_output: false,
      },
    },
    {
      id: "request-restart",
      type: "restart",
      reason: "improver workflow finished verification build",
      requires: [...RESTART_VERIFICATION_STEP_IDS],
    },
  ],
};

export default improverWorkflow;
