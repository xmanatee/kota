import type {
  WorkflowPredicate,
  WorkflowStepInput,
} from "../workflow/types.js";

export const BUILTIN_WORKFLOW_MODEL = "claude-sonnet-4-6";
export const READY_TASK_TARGET = 2;
export const BACKLOG_TASK_TARGET = 4;

const RESTART_VERIFICATION_STEP_IDS = [
  "verify-typecheck",
  "verify-lint",
  "verify-test",
  "verify-build",
] as const;

export function stepSucceeded(stepId: string): WorkflowPredicate {
  return ({ stepResults }) => stepResults[stepId]?.status === "success";
}

export function createVerificationAndRestartSteps(
  reason: string,
  stepId: string,
): WorkflowStepInput[] {
  const when = stepSucceeded(stepId);

  return [
    {
      id: "verify-typecheck",
      type: "tool",
      tool: "shell",
      when,
      input: {
        command: "npm run typecheck",
        stream_output: false,
      },
    },
    {
      id: "verify-lint",
      type: "tool",
      tool: "shell",
      when,
      input: {
        command: "npm run lint",
        stream_output: false,
      },
    },
    {
      id: "verify-test",
      type: "tool",
      tool: "shell",
      when,
      input: {
        command: "npm test",
        stream_output: false,
      },
    },
    {
      id: "verify-build",
      type: "tool",
      tool: "shell",
      when,
      input: {
        command: "npm run build",
        stream_output: false,
      },
    },
    {
      id: "request-restart",
      type: "restart",
      when,
      reason,
      requires: [...RESTART_VERIFICATION_STEP_IDS],
    },
  ];
}
