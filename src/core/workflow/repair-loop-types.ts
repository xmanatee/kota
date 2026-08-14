import type { AgentWriteScope } from "#core/agents/agent-types.js";
import type { RepairCheckResult } from "./repair-loop-checks.js";
import type { WorkflowRepairErrorKind } from "./run-types.js";
import { AgentStepRuntimeError } from "./steps/step-executor-retry.js";

export type RepairIteration = {
  attempt: number;
  failures: RepairCheckResult[];
  agentResponse?: string;
  agentTurns?: number;
  agentCostUsd?: number;
  agentInputTokens?: number;
  agentOutputTokens?: number;
  agentSessionId?: string;
  agentError?: string;
};

export type RepairLoopFailureOutput = {
  content: string;
  turns: number;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  sessionId?: string;
  repairIterations: RepairIteration[];
  repairWarnings: RepairCheckResult[];
};

export type ScopedRepairAgent = {
  agentName: string;
  writeScope: AgentWriteScope;
};

export class RepairLoopError extends Error {
  constructor(
    readonly kind: WorkflowRepairErrorKind | undefined,
    readonly stepId: string,
    readonly failureIds: string[],
    readonly output: RepairLoopFailureOutput,
    message: string,
    readonly agentBackoff?: AgentStepRuntimeError,
  ) {
    super(message);
    this.name = "RepairLoopError";
  }
}

/** A classified repair-agent failure with the repair usage retained. */
export class RepairAgentRuntimeError extends AgentStepRuntimeError {
  constructor(
    error: AgentStepRuntimeError,
    readonly stepId: string,
    readonly failureIds: string[],
    readonly output: RepairLoopFailureOutput,
  ) {
    super(error.message, error.kind, error.retryable, error.retryAt);
  }
}
