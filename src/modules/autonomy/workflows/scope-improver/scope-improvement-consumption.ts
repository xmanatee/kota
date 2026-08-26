import type {
  ScopeImprovementConsumptionDecision,
  ScopeImprovementInputs,
} from "./scope-improvement-types.js";

export function decideScopeImprovementConsumption(input: {
  inputs: ScopeImprovementInputs;
  recommendationCount: number;
  worktreeClean: boolean;
  actionApplied: boolean;
}): ScopeImprovementConsumptionDecision {
  if (
    input.inputs.semanticInput.automatic &&
    !input.inputs.alreadyConsumed &&
    !input.worktreeClean &&
    input.recommendationCount > 0 &&
    !input.actionApplied
  ) {
    return {
      disposition: "defer",
      reason: "semantic scope input deferred until the canonical repository is clean",
    };
  }
  if (!input.inputs.config.enabled) {
    return { disposition: "ignore", reason: "scope improvement is disabled" };
  }
  if (
    input.actionApplied ||
    input.inputs.alreadyConsumed ||
    input.recommendationCount === 0
  ) {
    return { disposition: "consume", reason: null };
  }
  return {
    disposition: "ignore",
    reason: "scope recommendations were not applied",
  };
}
