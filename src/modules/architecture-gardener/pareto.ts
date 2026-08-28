import type {
  ParetoEvaluation,
  SimplificationHypothesis,
  StructuralDimension,
} from "./types.js";

export type ParetoComparisonOptions = {
  readonly regressesProtectedInvariants?: boolean;
  readonly introducesDualOwnership?: boolean;
  readonly candidateScoreModifier?: number;
};

const DIMENSION_PREFERENCE_SCORE: Record<StructuralDimension, number> = {
  deletion: 100,
  "ownership-collapse": 90,
  "remove-obsolete-path": 80,
  "decouple-cycle": 70,
  "dependency-declaration": 60,
  "abstraction-consolidation": 50,
};

/**
 * Pareto comparator for architectural simplification hypotheses.
 *
 * Rules:
 * 1. Must make progress on at least one named structural dimension without regressing
 *    any protected invariant (core isolation, acyclicity, unique ownership, dependency hygiene).
 * 2. Behavior preservation claim must be explicit and non-empty.
 * 3. Removes or bounds the retired path without leaving permanent dual ownership.
 * 4. Prefers deletion, ownership collapse, and removal of obsolete paths over new abstractions.
 * 5. A new abstraction is justified ONLY when it replaces >= 2 real implementations or owners,
 *    names a stable variation axis, leaves consumers simpler, and has one canonical owner.
 */
export function evaluateParetoComparator(
  hypothesis: SimplificationHypothesis,
  options: ParetoComparisonOptions = {},
): ParetoEvaluation {
  const reasons: string[] = [];
  const improvedDimensions: string[] = [];
  let protectedInvariantsPreserved = true;

  // 1. Behavior preservation claim check
  if (
    !hypothesis.behaviorPreservationClaim ||
    hypothesis.behaviorPreservationClaim.trim().length === 0
  ) {
    reasons.push("Missing falsifiable behavior-preservation claim.");
    return {
      hypothesisId: hypothesis.id,
      disposition: "rejected",
      reasons,
      improvedDimensions,
      protectedInvariantsPreserved: false,
      score: 0,
    };
  }

  // 2. Protected invariants regression check
  if (options.regressesProtectedInvariants) {
    protectedInvariantsPreserved = false;
    reasons.push(
      "Proposed change regresses protected architectural invariants (e.g. introduces forbidden dependencies or cycles).",
    );
  }

  // 3. Dual ownership check
  if (options.introducesDualOwnership) {
    reasons.push(
      "Proposed change leaves permanent dual ownership or fails to remove/bound the retired path.",
    );
  }

  // 4. Abstraction justification rule
  if (hypothesis.structuralImprovement.dimension === "abstraction-consolidation") {
    const just = hypothesis.abstractionJustification;
    if (!just) {
      reasons.push(
        "New abstraction rejected: missing required abstraction justification.",
      );
    } else {
      if (just.replacesImplementationCount < 2) {
        reasons.push(
          `New abstraction rejected: replaces only ${just.replacesImplementationCount} implementation(s); must replace at least 2 real maintained implementations or owners.`,
        );
      }
      if (!just.variationAxis || just.variationAxis.trim().length === 0) {
        reasons.push(
          "New abstraction rejected: must name a stable variation axis.",
        );
      }
      if (!just.leavesConsumersSimpler) {
        reasons.push(
          "New abstraction rejected: must leave consumers strictly simpler.",
        );
      }
      if (!just.canonicalOwner || just.canonicalOwner.trim().length === 0) {
        reasons.push(
          "New abstraction rejected: must have exactly one canonical owner.",
        );
      }
    }
  }

  if (reasons.length > 0) {
    return {
      hypothesisId: hypothesis.id,
      disposition: "rejected",
      reasons,
      improvedDimensions,
      protectedInvariantsPreserved,
      score: 0,
    };
  }

  // Record improved dimension and score
  const dim = hypothesis.structuralImprovement.dimension;
  improvedDimensions.push(dim);
  const baseScore = DIMENSION_PREFERENCE_SCORE[dim] ?? 40;
  const score = baseScore + (options.candidateScoreModifier ?? 0);

  reasons.push(
    `Pareto improvement accepted: improves "${dim}" (${hypothesis.structuralImprovement.description}), preserves declared behavior, and avoids protected-invariant regressions.`,
  );

  return {
    hypothesisId: hypothesis.id,
    disposition: "accepted",
    reasons,
    improvedDimensions,
    protectedInvariantsPreserved: true,
    score,
  };
}
