import {
  detectRecurringOwnerInterventionPatternsFromReport,
} from "./owner-intervention-escalation-detect.js";
import {
  normalizeOwnerInterventionEscalationConfig,
  type OwnerInterventionEscalationConfig,
  type OwnerInterventionEscalationDetection,
} from "./owner-intervention-escalation-types.js";
import { buildOwnerInterventionReport } from "./report/owner-interventions.js";

export {
  detectRecurringOwnerInterventionPatternsFromReport,
} from "./owner-intervention-escalation-detect.js";
export {
  buildOwnerInterventionEscalationReport,
} from "./owner-intervention-escalation-report.js";
export type {
  OwnerInterventionEscalationConfig,
  OwnerInterventionEscalationDetection,
  OwnerInterventionEscalationReport,
  OwnerInterventionEscalationThresholds,
  OwnerInterventionEvidenceRef,
  OwnerInterventionPattern,
  OwnerInterventionPatternActionability,
  OwnerInterventionPatternDimension,
  OwnerInterventionPatternKind,
  OwnerInterventionPatternSummary,
} from "./owner-intervention-escalation-types.js";
export {
  DEFAULT_OWNER_INTERVENTION_MIN_DISTINCT_RUNS,
  DEFAULT_OWNER_INTERVENTION_MIN_QUESTIONS,
  DEFAULT_OWNER_INTERVENTION_REPORT_LIMIT,
  DEFAULT_OWNER_INTERVENTION_WINDOW_MS,
} from "./owner-intervention-escalation-types.js";

export function detectRecurringOwnerInterventionPatterns(
  workspaceRoot: string,
  config?: OwnerInterventionEscalationConfig,
): OwnerInterventionEscalationDetection {
  const normalized = normalizeOwnerInterventionEscalationConfig(config);
  const report = buildOwnerInterventionReport({
    workspaceRoot,
    windowStartMs: normalized.nowMs - normalized.windowMs,
    windowEndMs: normalized.nowMs,
    includeEscalation: false,
  });
  return detectRecurringOwnerInterventionPatternsFromReport({
    report,
    config: normalized,
  });
}
