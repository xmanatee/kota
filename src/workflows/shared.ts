import type { WorkflowStepInput } from "../workflow/types.js";

export const BUILTIN_WORKFLOW_MODEL = "claude-sonnet-4-6";

const RESTART_VERIFICATION_STEP_IDS = [
  "verify-typecheck",
  "verify-lint",
  "verify-test",
  "verify-build",
] as const;

export function createVerificationAndRestartSteps(
  reason: string,
): WorkflowStepInput[] {
  return [
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
      id: "verify-lint",
      type: "tool",
      tool: "shell",
      input: {
        command: "npm run lint",
        stream_output: false,
      },
    },
    {
      id: "verify-test",
      type: "tool",
      tool: "shell",
      input: {
        command: "npm test",
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
      reason,
      requires: [...RESTART_VERIFICATION_STEP_IDS],
    },
  ];
}
