import type { WorkflowDefinitionInput } from "../../workflow/types.js";

const RESTART_VERIFICATION_STEP_IDS = [
  "verify-typecheck",
  "verify-workflow-critical",
  "verify-build",
] as const;

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
      reason: "builder workflow finished verification build",
      requires: [...RESTART_VERIFICATION_STEP_IDS],
    },
  ],
};

export default builderWorkflow;
