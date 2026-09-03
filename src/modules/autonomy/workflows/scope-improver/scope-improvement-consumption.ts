import type {
  ScopeImprovementConsumptionDecision,
  ScopeImprovementInputs,
} from "./scope-improvement-types.js";

export function decideScopeImprovementConsumption(input: {
  inputs: ScopeImprovementInputs;
  recommendationCount: number;
  worktreeClean: boolean;
  actionApplied: boolean;
  parkedReason: string | null;
}): ScopeImprovementConsumptionDecision {
  if (
    input.inputs.semanticInput.automatic &&
    (input.parkedReason !== null || !input.inputs.config.enabled)
  ) {
    return {
      disposition: "defer",
      reason: input.parkedReason ?? "scope improvement is disabled",
    };
  }
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
