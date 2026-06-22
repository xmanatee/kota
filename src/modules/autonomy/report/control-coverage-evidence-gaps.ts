import { join } from "node:path";
import type {
  EvidenceJsonObject,
  EvidencePrunedReference,
} from "#core/evidence/policy.js";
import { EVIDENCE_PRUNED_REASON_CODE } from "#core/evidence/pruned-reference.js";
import { PRUNED_RUN_REFERENCES_FILE } from "#core/workflow/run-store-retention.js";

export type ControlCoverageEvidenceGapKind = "policy-pruned" | "producer-missing";

export type ControlCoverageEvidenceGapReasonCode =
  | typeof EVIDENCE_PRUNED_REASON_CODE
  | "producer-missing";

export type ControlCoverageEvidenceGap = {
  kind: ControlCoverageEvidenceGapKind;
  reasonCode: ControlCoverageEvidenceGapReasonCode;
  ref: string;
  summary: string;
};

export type ControlCoverageEvidenceGapSummary = {
  kind: ControlCoverageEvidenceGapKind;
  reasonCode: ControlCoverageEvidenceGapReasonCode;
  count: number;
  evidenceRefs: string[];
  summaries: string[];
};

function prunedRunReferenceRef(runId: string): string {
  return `${join(".kota", "runs", PRUNED_RUN_REFERENCES_FILE)}#${runId}`;
}

function retainedString(retained: EvidenceJsonObject, key: string): string | null {
  const value = retained[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isWithinWindow(
  value: string | null,
  windowStartMs: number,
  windowEndMs: number,
): boolean {
  if (value === null) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= windowStartMs && timestamp <= windowEndMs;
}

export function policyPrunedControlCoverageEvidenceGapsForWindow(
  references: readonly EvidencePrunedReference[],
  windowStartMs: number,
  windowEndMs: number,
): ControlCoverageEvidenceGap[] {
  const gaps: ControlCoverageEvidenceGap[] = [];
  for (const reference of references) {
    if (reference.artifactType !== "workflow-run") continue;
    const workflow = retainedString(reference.retained, "workflow") ?? "unknown";
    const status = retainedString(reference.retained, "status") ?? "unknown";
    const startedAt = retainedString(reference.retained, "startedAt");
    if (
      !isWithinWindow(startedAt, windowStartMs, windowEndMs) &&
      !isWithinWindow(reference.prunedAt, windowStartMs, windowEndMs)
    ) {
      continue;
    }
    gaps.push({
      kind: "policy-pruned",
      reasonCode: EVIDENCE_PRUNED_REASON_CODE,
      ref: prunedRunReferenceRef(reference.id),
      summary:
        `${workflow} ${status} (${reference.id}) control coverage body unavailable: ` +
        EVIDENCE_PRUNED_REASON_CODE,
    });
  }
  return gaps;
}
