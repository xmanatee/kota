import type { KotaAgentMessageType } from "#core/agent-harness/agent-message.js";
import type { KotaAgentMessage } from "#core/agent-harness/types.js";
import { AgentStepRuntimeError } from "./steps/step-executor-retry.js";

export type WorkflowStepProgressEvent =
  | { kind: "agent-message"; messageType: KotaAgentMessageType }
  | { kind: "agent-result" }
  | { kind: "code-heartbeat"; label?: string };

export type WorkflowStepProgressReporter = (
  event: WorkflowStepProgressEvent,
) => void;

export function isAgentProgressMessage(message: KotaAgentMessage): boolean {
  if (message.type === "raw") return false;
  if (message.type === "text") return message.text.length > 0;
  if (message.type === "thinking") return message.thinking.length > 0;
  return true;
}

export class WorkflowStepIdleTimeoutError extends Error {
  constructor(
    readonly stepId: string,
    readonly idleTimeoutMs: number,
    readonly idleForMs: number,
  ) {
    super(
      `Step "${stepId}" idle timed out after ${idleTimeoutMs}ms without runtime progress`,
    );
    this.name = "WorkflowStepIdleTimeoutError";
  }
}

export class AgentStepIdleTimeoutError extends AgentStepRuntimeError {
  constructor(
    readonly stepId: string,
    readonly idleTimeoutMs: number,
    readonly idleForMs: number,
  ) {
    super(
      `Agent step "${stepId}" idle timed out after ${idleTimeoutMs}ms without runtime progress`,
      "provider",
      true,
    );
    this.name = "AgentStepIdleTimeoutError";
  }
}

export type StepIdleTimeoutMonitor = {
  reportProgress: WorkflowStepProgressReporter;
  timeout: Promise<never>;
  dispose: () => void;
};

export function createStepIdleTimeoutMonitor(args: {
  stepId: string;
  idleTimeoutMs: number;
  abortController: AbortController;
  createError: (idleForMs: number) => Error;
}): StepIdleTimeoutMonitor {
  let settled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let lastProgressAt = Date.now();
  let rejectTimeout: (error: Error) => void = () => {};

  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });

  const clear = () => {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    timeoutHandle = undefined;
  };

  const fire = () => {
    if (settled) return;
    settled = true;
    const error = args.createError(Date.now() - lastProgressAt);
    rejectTimeout(error);
    args.abortController.abort(error);
  };

  const schedule = () => {
    clear();
    timeoutHandle = setTimeout(fire, args.idleTimeoutMs);
  };

  schedule();

  return {
    reportProgress: (_event) => {
      if (settled) return;
      lastProgressAt = Date.now();
      schedule();
    },
    timeout,
    dispose: () => {
      settled = true;
      clear();
    },
  };
}
