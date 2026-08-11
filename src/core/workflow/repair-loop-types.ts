import type { AgentWriteScope } from "#core/agents/agent-types.js";
import type { RepairCheckResult } from "./repair-loop-checks.js";
import type { WorkflowRepairErrorKind } from "./run-types.js";
import type { AgentStepRuntimeError } from "./steps/step-executor-retry.js";

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
