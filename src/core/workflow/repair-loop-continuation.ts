import {
  RepairLoopError,
  type RepairLoopFailureOutput,
  RepairLoopYield,
} from "./repair-loop-types.js";
import type { WorkflowStepContext } from "./run-types.js";
import type {
  WorkflowAgentRunContractSpec,
  WorkflowAgentStep,
} from "./step-types.js";

export type WorkflowRepairContinuationDecisionKind =
  | "continue"
  | "decompose"
  | "preserve-yield"
  | "needs-owner";

export type WorkflowRepairContinuationPacket = {
  schemaVersion: 1;
  boundaryKey: string;
  boundaryReasons: string[];
  attempt: number;
  failureIds: string[];
  warningIds: string[];
  progressKey: string;
  trajectory: {
    classification: string;
    attempts: number;
    failureIdsByAttempt: string[][];
  };
  context: Array<{ label: string; value: string }>;
};

export type WorkflowRepairContinuationDecision = {
  decision: WorkflowRepairContinuationDecisionKind;
  evidenceKey: string;
  summary: string;
  nextAction: string;
  packet: WorkflowRepairContinuationPacket;
};

export type WorkflowRepairContinuationInput = {
  attempt: number;
  failureIds: string[];
  warningIds: string[];
  progressKey: string;
  previousProgressKey: string;
  progressChanged: boolean;
  noProgressAttempts: number;
  repairIterations: Array<{ attempt: number; failureIds: string[] }>;
};

export type WorkflowRepairContinuationController = {
  evaluate: (
    input: WorkflowRepairContinuationInput,
    context: WorkflowStepContext,
    parentStep: WorkflowAgentStep,
  ) =>
    | Promise<WorkflowRepairContinuationDecision | null>
    | WorkflowRepairContinuationDecision
    | null;
  resolveAgentContract?: (
    parentStep: WorkflowAgentStep,
  ) => WorkflowAgentRunContractSpec;
};

export function createRepairContinuationEvaluator(input: {
  controller: WorkflowRepairContinuationController | undefined;
  context: WorkflowStepContext;
  step: WorkflowAgentStep;
  decisions: WorkflowRepairContinuationDecision[];
  failureOutput: () => RepairLoopFailureOutput;
}): (candidate: WorkflowRepairContinuationInput) => Promise<void> {
  return async (candidate) => {
    if (input.controller === undefined) return;
    let decision: WorkflowRepairContinuationDecision | null;
    try {
      decision = await input.controller.evaluate(
        candidate,
        input.context,
        input.step,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RepairLoopError(
        undefined,
        input.step.id,
        candidate.failureIds,
        input.failureOutput(),
        `Repair continuation authority failed for step "${input.step.id}": ${message}`,
      );
    }
    if (decision === null) return;
    if (!isValidContinuationDecision(decision, candidate.attempt)) {
      throw new RepairLoopError(
        undefined,
        input.step.id,
        candidate.failureIds,
        input.failureOutput(),
        `Repair continuation authority returned an invalid decision for step "${input.step.id}"`,
      );
    }
    input.decisions.push(decision);
    if (decision.decision === "continue") return;
    if (decision.decision === "preserve-yield") {
      throw new RepairLoopYield(input.step.id, input.failureOutput(), decision);
    }
    throw new RepairLoopError(
      continuationErrorKind(decision.decision),
      input.step.id,
      candidate.failureIds,
      input.failureOutput(),
      `Repair continuation decision for step "${input.step.id}": ${decision.decision} — ${decision.summary}`,
    );
  };
}

function isValidContinuationDecision(
  decision: WorkflowRepairContinuationDecision,
  attempt: number,
): boolean {
  return (
    ["continue", "decompose", "preserve-yield", "needs-owner"].includes(
      decision.decision,
    ) &&
    decision.evidenceKey.trim().length > 0 &&
    decision.evidenceKey === decision.packet.boundaryKey &&
    decision.packet.attempt === attempt &&
    decision.summary.trim().length > 0 &&
    decision.nextAction.trim().length > 0
  );
}

function continuationErrorKind(
  decision: Exclude<
    WorkflowRepairContinuationDecisionKind,
    "continue" | "preserve-yield"
  >,
): "repair-decompose" | "repair-needs-owner" {
  if (decision === "decompose") return "repair-decompose";
  return "repair-needs-owner";
}
