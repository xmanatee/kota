import type {
  AutonomyHealthSignal,
  AutonomyHealthSignalInput,
} from "#modules/autonomy/health-signal.js";
import { normalizeHealthSignal } from "#modules/autonomy/health-signal.js";
import {
  MAX_EVIDENCE_REFS_PER_PATTERN,
  patternSummary,
  type RuntimeHealthAuditContext,
  type RuntimeHealthAuditPattern,
  SEVERITY_RANK,
} from "./runtime-health-audit-model.js";

export function finalizedPatterns(
  ctx: RuntimeHealthAuditContext,
): RuntimeHealthAuditPattern[] {
  return [...ctx.patterns.values()]
    .map((pattern) => ({
      dedupeKey: pattern.dedupeKey,
      category: pattern.category,
      severity: pattern.severity,
      actionability: pattern.actionability,
      labels: [...pattern.labels].sort((a, b) => a.localeCompare(b)),
      summary: patternSummary(pattern),
      source: pattern.source,
      observationCount: pattern.observationCount,
      evidenceRefs: [...pattern.evidenceRefs.values()].slice(
        0,
        MAX_EVIDENCE_REFS_PER_PATTERN,
      ),
    }))
    .sort((a, b) => {
      const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (severityDelta !== 0) return severityDelta;
      return a.dedupeKey.localeCompare(b.dedupeKey);
    });
}

export function signalForPattern(
  pattern: RuntimeHealthAuditPattern,
  createdAt: string,
): AutonomyHealthSignal {
  const input: AutonomyHealthSignalInput = {
    observation: "present",
    source: pattern.source,
    severity: pattern.severity,
    labels: pattern.labels,
    summary: pattern.summary,
    evidenceRefs: pattern.evidenceRefs,
    actionability: pattern.actionability,
    dedupeKey: pattern.dedupeKey,
    observationCount: pattern.observationCount,
    createdAt,
  };
  return normalizeHealthSignal(input);
}
