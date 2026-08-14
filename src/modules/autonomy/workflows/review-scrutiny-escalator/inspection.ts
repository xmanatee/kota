import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  detectRecurringReviewScrutinyPatterns,
  type ReviewScrutinyEscalationDetection,
} from "#modules/autonomy/review-scrutiny-escalation.js";
import {
  emptyReviewScrutinyDetection,
  readReviewScrutinyEscalatorConfig,
} from "./config.js";

export type ReviewScrutinyInspection = {
  dirty: boolean;
  status: "dirty" | "none" | "patterns-detected";
  detection: ReviewScrutinyEscalationDetection;
};

export function inspectReviewScrutinyPatternsInWorker(input: {
  projectDir: string;
}): ReviewScrutinyInspection {
  const config = readReviewScrutinyEscalatorConfig();
  const worktree = getRepoWorktreeStatus(input.projectDir);
  const dirty = worktree.available && worktree.dirty;
  if (dirty) {
    return {
      dirty,
      status: "dirty",
      detection: emptyReviewScrutinyDetection(config),
    };
  }
  const detection = detectRecurringReviewScrutinyPatterns(
    input.projectDir,
    join(input.projectDir, ".kota", "runs"),
    config,
  );
  return {
    dirty,
    status: detection.patterns.length > 0 ? "patterns-detected" : "none",
    detection,
  };
}

export const inspectReviewScrutinyPatternsOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    ReviewScrutinyInspection
  >(import.meta.url, "inspectReviewScrutinyPatternsInWorker");
