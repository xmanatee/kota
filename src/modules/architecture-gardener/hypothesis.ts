import { createHash } from "node:crypto";
import type {
  AbstractionJustification,
  AdmissionEvaluation,
  CandidateAction,
  SimplificationHypothesis,
  StructuralDimension,
} from "./types.js";

/** Formulate a unique hypothesis id from target scope and dimension. */
export function generateHypothesisId(
  targetScope: string,
  dimension: StructuralDimension,
): string {
  const digest = createHash("sha256")
    .update(`${targetScope}:${dimension}`)
    .digest("hex")
    .slice(0, 12);
  return `hyp-${dimension}-${digest}`;
}

/** Formulate a SimplificationHypothesis from an admitted evaluation. */
export function formulateHypothesisFromAdmission(args: {
  evaluation: AdmissionEvaluation;
  problem?: string;
  behaviorPreservationClaim?: string;
  dimension?: StructuralDimension;
  description?: string;
  candidateActions?: readonly CandidateAction[];
  abstractionJustification?: AbstractionJustification;
  now?: string;
}): SimplificationHypothesis {
  const { evaluation } = args;
  const now = args.now ?? new Date().toISOString();

  // Infer default dimension and actions if not supplied
  let dimension: StructuralDimension = args.dimension ?? "deletion";
  const problem = args.problem ?? evaluation.reason;
  let description = args.description ?? "";
  const actions: CandidateAction[] = args.candidateActions
    ? [...args.candidateActions]
    : [];

  const firstSignal = evaluation.signals[0];
  if (!args.dimension && firstSignal) {
    if (firstSignal.kind === "structural-violation") {
      if (firstSignal.summary.includes("cycle")) {
        dimension = "decouple-cycle";
        description = `Decouple cyclic dependency in ${evaluation.targetScope}`;
        actions.push({
          type: "break-cycle",
          target: evaluation.targetScope,
          details: "Break cycle by inverting dependency or extracting shared leaf interface",
        });
      } else if (firstSignal.summary.includes("Undeclared")) {
        dimension = "dependency-declaration";
        description = `Declare missing module dependency for ${evaluation.targetScope}`;
        actions.push({
          type: "codemod",
          target: evaluation.targetScope,
          details: "Add target module to dependencies array in index.ts",
        });
      } else if (firstSignal.summary.includes("Forbidden")) {
        dimension = "decouple-cycle";
        description = `Decouple forbidden core-to-module dependency in ${evaluation.targetScope}`;
        actions.push({
          type: "remove-path",
          target: evaluation.targetScope,
          details: "Remove or invert #modules/* import from core source",
        });
      } else if (firstSignal.summary.includes("Duplicate")) {
        dimension = "ownership-collapse";
        description = `Collapse duplicate canonical ownership in ${evaluation.targetScope}`;
        actions.push({
          type: "collapse-ownership",
          target: evaluation.targetScope,
          details: "Consolidate multiple contributors into one canonical owner",
        });
      }
    } else {
      dimension = "deletion";
      description = `Eliminate dead or duplicated logic in ${evaluation.targetScope}`;
      actions.push({
        type: "delete",
        target: evaluation.targetScope,
        details: "Remove duplicated implementation chunks or obsolete paths",
      });
    }
  }

  if (!description) {
    description = `Simplify ${dimension} in ${evaluation.targetScope}`;
  }

  const behaviorPreservationClaim =
    args.behaviorPreservationClaim ??
    `Preserves all declared public interfaces and runtime behavior for ${evaluation.targetScope}. All existing unit and contract tests continue to pass without modification.`;

  const id = generateHypothesisId(evaluation.targetScope, dimension);

  return {
    id,
    targetScope: evaluation.targetScope,
    problem,
    behaviorPreservationClaim,
    structuralImprovement: {
      dimension,
      description,
    },
    candidateActions: actions,
    abstractionJustification: args.abstractionJustification,
    evidenceFingerprints: evaluation.signals.map((s) => s.fingerprint),
    admittedAt: now,
  };
}
