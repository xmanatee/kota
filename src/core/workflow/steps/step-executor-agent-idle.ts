import type { KotaAgentMessage } from "#core/agent-harness/index.js";
import {
  AgentStepIdleTimeoutError,
  createStepIdleTimeoutMonitor,
  isAgentProgressMessage,
} from "../step-idle-timeout.js";
import type { WorkflowAgentStep } from "../step-types.js";

export type AgentStepIdleMonitor = ReturnType<typeof createStepIdleTimeoutMonitor>;

export function createAgentStepIdleMonitor(
  step: WorkflowAgentStep,
  abortController: AbortController,
): AgentStepIdleMonitor | undefined {
  const idleTimeoutMs = step.idleTimeoutMs;
  if (idleTimeoutMs === undefined) return undefined;
  return createStepIdleTimeoutMonitor({
    stepId: step.id,
    idleTimeoutMs,
    abortController,
    createError: (idleForMs) =>
      new AgentStepIdleTimeoutError(
        step.id,
        idleTimeoutMs,
        idleForMs,
      ),
  });
}

export function createAgentAttemptMessageCapture(input: {
  messages: KotaAgentMessage[];
  idleMonitor: () => AgentStepIdleMonitor | undefined;
  bufferAgentMessages: boolean;
  appendMessage: (message: KotaAgentMessage) => void;
}): (message: KotaAgentMessage) => void {
  return (message) => {
    input.messages.push(message);
    const monitor = input.idleMonitor();
    if (monitor !== undefined && isAgentProgressMessage(message)) {
      monitor.reportProgress({
        kind: "agent-message",
        messageType: message.type,
      });
    }
    if (!input.bufferAgentMessages) {
      input.appendMessage(message);
    }
  };
}

export async function waitForAgentHarnessWithIdleMonitor<T>(
  harnessRun: Promise<T>,
  idleMonitor: AgentStepIdleMonitor | undefined,
): Promise<T> {
  const result = await (idleMonitor === undefined
    ? harnessRun
    : Promise.race([harnessRun, idleMonitor.timeout]));
  idleMonitor?.reportProgress({ kind: "agent-result" });
  return result;
}
