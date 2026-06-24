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
  buildOwnerInterventionAttentionDigest,
  buildOwnerInterventionEscalationReport,
} from "./owner-intervention-escalation-report.js";
export {
  applyOwnerInterventionEscalation,
  proposeOwnerInterventionEscalation,
} from "./owner-intervention-escalation-tasks.js";
export type {
  OwnerInterventionAttentionEntry,
  OwnerInterventionEscalationApplied,
  OwnerInterventionEscalationConfig,
  OwnerInterventionEscalationContext,
  OwnerInterventionEscalationDetection,
  OwnerInterventionEscalationProposal,
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
  OWNER_INTERVENTION_EVIDENCE_FINGERPRINT_RE,
  OWNER_INTERVENTION_TASK_ID_PREFIX,
} from "./owner-intervention-escalation-types.js";

export function detectRecurringOwnerInterventionPatterns(
  projectDir: string,
  config?: OwnerInterventionEscalationConfig,
): OwnerInterventionEscalationDetection {
  const normalized = normalizeOwnerInterventionEscalationConfig(config);
  const report = buildOwnerInterventionReport({
    projectDir,
    windowStartMs: normalized.nowMs - normalized.windowMs,
    windowEndMs: normalized.nowMs,
    includeEscalation: false,
  });
  return detectRecurringOwnerInterventionPatternsFromReport({
    report,
    config: normalized,
  });
}
