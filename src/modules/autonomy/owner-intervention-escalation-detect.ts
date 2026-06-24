import {
  observationKey,
  observationsForRecord,
  type PatternObservation,
} from "./owner-intervention-escalation-observations.js";
import {
  buildPattern,
  collapseDuplicateDimensionPatterns,
} from "./owner-intervention-escalation-patterns.js";
import {
  normalizeOwnerInterventionEscalationConfig,
  type OwnerInterventionEscalationConfig,
  type OwnerInterventionEscalationDetection,
  ownerInterventionThresholds,
} from "./owner-intervention-escalation-types.js";
import type {
  OwnerInterventionReport,
} from "./report/owner-intervention-types.js";

export function detectRecurringOwnerInterventionPatternsFromReport(args: {
  report: OwnerInterventionReport;
  config?: OwnerInterventionEscalationConfig;
}): OwnerInterventionEscalationDetection {
  const config = normalizeOwnerInterventionEscalationConfig(args.config);
  const windowStartMs = config.nowMs - config.windowMs;
  const grouped = new Map<string, PatternObservation[]>();
  for (const record of args.report.records) {
    const createdMs = Date.parse(record.createdAt);
    if (
      !Number.isFinite(createdMs) ||
      createdMs < windowStartMs ||
      createdMs > config.nowMs
    ) {
      continue;
    }
    for (const observation of observationsForRecord(record)) {
      const key = observationKey(observation);
      const list = grouped.get(key) ?? [];
      list.push(observation);
      grouped.set(key, list);
    }
  }
  const candidates = collapseDuplicateDimensionPatterns(
    [...grouped.values()].map((observations) => buildPattern(observations, config)),
  );
  return {
    thresholds: ownerInterventionThresholds(config),
    patterns: candidates.filter((pattern) =>
      pattern.actionability === "code-actionable" && pattern.belowThresholdReason === null
    ),
    ignoredPatterns: candidates.filter((pattern) =>
      pattern.actionability === "ignored" && pattern.belowThresholdReason === null
    ),
    belowThresholdPatterns: candidates.filter((pattern) =>
      pattern.actionability === "code-actionable" && pattern.belowThresholdReason !== null
    ),
  };
}
