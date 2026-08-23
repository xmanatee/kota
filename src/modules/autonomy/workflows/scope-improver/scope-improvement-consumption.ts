import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  deferScopeImprovementInput,
  writeScopeImprovementState,
} from "./scope-improvement-state.js";
import type {
  ScopeImprovementConsumptionDecision,
  ScopeImprovementInputs,
} from "./scope-improvement-types.js";

type ScopeImprovementConsumptionInput = {
  projectDir: string;
  inputs: ScopeImprovementInputs;
  recommendationCount: number;
  worktreeClean: boolean;
  actionApplied: boolean;
};

export function recordScopeImprovementConsumptionInWorker(
  input: ScopeImprovementConsumptionInput,
): ScopeImprovementConsumptionDecision {
  const { inputs } = input;
  if (
    inputs.semanticInput.automatic &&
    !inputs.alreadyConsumed &&
    !input.worktreeClean &&
    input.recommendationCount > 0 &&
    !input.actionApplied
  ) {
    deferScopeImprovementInput(input.projectDir, inputs);
    return {
      recorded: false,
      reason: "semantic scope input deferred until the canonical worktree is clean",
    };
  }
  if (!inputs.config.enabled || input.actionApplied) {
    return { recorded: false, reason: null };
  }
  const reason = inputs.alreadyConsumed
    ? "latest automatic scope fingerprint was already consumed"
    : input.recommendationCount === 0
      ? "semantic input produced no scope-improvement recommendations"
      : null;
  if (reason === null) return { recorded: false, reason: null };
  writeScopeImprovementState({
    projectDir: input.projectDir,
    inputs,
    actions: [],
  });
  return { recorded: true, reason };
}

export const recordScopeImprovementConsumptionOperation =
  defineWorkflowBlockingOperation<
    ScopeImprovementConsumptionInput,
    ScopeImprovementConsumptionDecision
  >(import.meta.url, "recordScopeImprovementConsumptionInWorker");
