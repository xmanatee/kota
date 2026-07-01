import { redactSensitiveText } from "#core/evidence/policy.js";
import type { AutonomyHealthEvidenceRef } from "./health-signal.js";

const RUNTIME_DERIVED_EVIDENCE_KINDS = new Set<AutonomyHealthEvidenceRef["kind"]>([
  "dead-letter",
  "module-log",
]);

export const RUNTIME_DERIVED_SUMMARY_OMITTED =
  "[runtime-derived summary omitted; inspect evidence refs]";

export function hasRuntimeDerivedHealthEvidence(
  refs: readonly AutonomyHealthEvidenceRef[],
): boolean {
  return refs.some((ref) => RUNTIME_DERIVED_EVIDENCE_KINDS.has(ref.kind));
}

export function projectAutonomyHealthEvidenceRefForReview(
  ref: AutonomyHealthEvidenceRef,
): AutonomyHealthEvidenceRef {
  if (RUNTIME_DERIVED_EVIDENCE_KINDS.has(ref.kind)) {
    return {
      kind: ref.kind,
      ref: ref.ref,
    };
  }
  return {
    kind: ref.kind,
    ref: ref.ref,
    ...(ref.summary !== undefined
      ? { summary: redactSensitiveText(ref.summary) }
      : {}),
  };
}

export function projectAutonomyHealthEvidenceRefsForReview(
  refs: readonly AutonomyHealthEvidenceRef[],
): AutonomyHealthEvidenceRef[] {
  return refs.map(projectAutonomyHealthEvidenceRefForReview);
}

export function projectAutonomyHealthSummaryForReview(
  summary: string,
  refs: readonly AutonomyHealthEvidenceRef[],
): string {
  if (hasRuntimeDerivedHealthEvidence(refs)) return RUNTIME_DERIVED_SUMMARY_OMITTED;
  return redactSensitiveText(summary);
}

export function projectAutonomyHealthSummariesForReview(
  summaries: readonly string[],
  refs: readonly AutonomyHealthEvidenceRef[],
): string[] {
  if (hasRuntimeDerivedHealthEvidence(refs)) return [];
  return summaries.map((summary) => redactSensitiveText(summary));
}
