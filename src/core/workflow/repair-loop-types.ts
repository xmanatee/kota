import type { AgentWriteScope } from "#core/agents/agent-types.js";
import type { RepairCheckResult } from "./repair-loop-checks.js";
import type {
  WorkflowRepairErrorKind,
  WorkflowStepErrorKind,
} from "./run-types.js";
import {
  AGENT_STEP_RUNTIME_ERROR,
  installAgentStepRuntimeErrorBrand,
} from "./steps/agent-step-runtime-error-brand.js";
import { AgentStepRuntimeError } from "./steps/step-executor-retry.js";
import type { WorkflowAgentBackoffKind } from "./trigger-types.js";

installAgentStepRuntimeErrorBrand(AgentStepRuntimeError);

export type RepairIteration = {
  attempt: number;
  failures: RepairCheckResult[];
  agentResponse?: string;
  agentTurns?: number;
  agentSessionId?: string;
  agentError?: string;
};

export type RepairLoopFailureOutput = {
  content: string;
  turns: number;
  sessionId?: string;
  repairIterations: RepairIteration[];
  repairWarnings: RepairCheckResult[];
};

export type ScopedRepairAgent = {
  agentName: string;
  writeScope: AgentWriteScope;
};

export class RepairLoopError extends Error {
  [AGENT_STEP_RUNTIME_ERROR]: boolean;
  private stepRuntimeKind: WorkflowAgentBackoffKind | undefined;

  constructor(
    readonly repairKind: WorkflowRepairErrorKind | undefined,
    readonly stepId: string,
    readonly failureIds: string[],
    readonly output: RepairLoopFailureOutput,
    message: string,
    readonly agentBackoff?: AgentStepRuntimeError,
  ) {
    super(message);
    this.name = "RepairLoopError";
    this[AGENT_STEP_RUNTIME_ERROR] = false;
  }

  get kind(): WorkflowStepErrorKind | undefined {
    return this.repairKind ?? this.stepRuntimeKind;
  }

  get retryable(): boolean | undefined {
    return this.stepRuntimeKind === undefined
      ? undefined
      : this.agentBackoff?.retryable;
  }

  get retryAt(): string | undefined {
    return this.stepRuntimeKind === undefined
      ? undefined
      : this.agentBackoff?.retryAt;
  }

  asAgentStepRuntimeError(): this {
    if (this.repairKind === undefined && this.agentBackoff !== undefined) {
      this.stepRuntimeKind = this.agentBackoff.kind;
      this[AGENT_STEP_RUNTIME_ERROR] = true;
    }
    return this;
  }
}

/** A classified repair-agent failure with repair evidence retained. */
export class RepairAgentRuntimeError extends RepairLoopError {
  constructor(
    error: AgentStepRuntimeError,
    stepId: string,
    failureIds: string[],
    output: RepairLoopFailureOutput,
  ) {
    super(undefined, stepId, failureIds, output, error.message, error);
    this.name = AgentStepRuntimeError.name;
    this.asAgentStepRuntimeError();
  }
}
