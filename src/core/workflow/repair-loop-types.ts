import type { AgentWriteScope } from "#core/agents/agent-types.js";
import type { AgentBackoffAdmissionError } from "./agent-backoff.js";
import type { WorkflowContinuationRecord } from "./continuation.js";
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
  agentSubtype?: string;
  agentError?: string;
};

export type RepairLoopFailureOutput = {
  content: string;
  turns: number;
  sessionId?: string;
  repairIterations: RepairIteration[];
  repairWarnings: RepairCheckResult[];
  continuationDecisions?: WorkflowContinuationRecord[];
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
    readonly agentBackoff?: AgentStepRuntimeError | AgentBackoffAdmissionError,
  ) {
    super(message);
    this.name = "RepairLoopError";
    this[AGENT_STEP_RUNTIME_ERROR] = false;
  }

  get kind(): WorkflowStepErrorKind | undefined {
    return this.repairKind ?? this.stepRuntimeKind;
  }

  get retryable(): boolean | undefined {
    return this.stepRuntimeKind === undefined || !(this.agentBackoff instanceof AgentStepRuntimeError)
      ? undefined
      : this.agentBackoff.retryable;
  }

  get retryAt(): string | undefined {
    return this.stepRuntimeKind === undefined || !(this.agentBackoff instanceof AgentStepRuntimeError)
      ? undefined
      : this.agentBackoff.retryAt;
  }

  asAgentStepRuntimeError(): this {
    if (this.repairKind === undefined && this.agentBackoff instanceof AgentStepRuntimeError) {
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

/** A judged continuation transition retained as ordinary repair evidence. */
export class WorkflowContinuationSuspension extends RepairLoopError {
  private readonly checkpointFailures: string[] = [];

  constructor(
    readonly continuation: WorkflowContinuationRecord,
    stepId: string,
    failureIds: string[],
    output: RepairLoopFailureOutput,
  ) {
    super(
      continuation.decision.decision === "decompose"
        ? "continuation-decompose"
        : undefined,
      stepId,
      failureIds,
      output,
      `Workflow continuation decision: ${continuation.decision.decision} — ${continuation.decision.rationale}`,
    );
    this.name = "WorkflowContinuationSuspension";
  }

  recordCheckpointFailure(phase: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.checkpointFailures.push(`${phase}: ${detail}`);
  }

  get checkpointFailure(): string | undefined {
    return this.checkpointFailures.length === 0
      ? undefined
      : this.checkpointFailures.join("; ");
  }
}
