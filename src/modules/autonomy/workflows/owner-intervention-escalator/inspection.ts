import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  detectRecurringOwnerInterventionPatterns,
  type OwnerInterventionEscalationDetection,
} from "#modules/autonomy/owner-intervention-escalation.js";
import {
  normalizeOwnerInterventionEscalationConfig,
  ownerInterventionThresholds,
} from "#modules/autonomy/owner-intervention-escalation-types.js";

export type OwnerInterventionInspection = {
  dirty: boolean;
  status: "dirty" | "none" | "patterns-detected";
  detection: OwnerInterventionEscalationDetection;
};

function emptyDetection(): OwnerInterventionEscalationDetection {
  const config = normalizeOwnerInterventionEscalationConfig();
  return {
    thresholds: ownerInterventionThresholds(config),
    patterns: [],
    ignoredPatterns: [],
    belowThresholdPatterns: [],
  };
}

export function inspectOwnerInterventionPatternsInWorker(input: {
  projectDir: string;
}): OwnerInterventionInspection {
  const worktree = getRepoWorktreeStatus(input.projectDir);
  const dirty = worktree.available && worktree.dirty;
  if (dirty) {
    return { dirty, status: "dirty", detection: emptyDetection() };
  }
  const detection = detectRecurringOwnerInterventionPatterns(input.projectDir);
  return {
    dirty,
    status: detection.patterns.length > 0 ? "patterns-detected" : "none",
    detection,
  };
}

export const inspectOwnerInterventionPatternsOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    OwnerInterventionInspection
  >(import.meta.url, "inspectOwnerInterventionPatternsInWorker");
