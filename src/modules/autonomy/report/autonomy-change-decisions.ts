import { join } from "node:path";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  AUTONOMY_CHANGE_DECISION_ARTIFACT,
  readAutonomyChangeDecisionArtifact,
} from "../autonomy-change-decision.js";
import type {
  AutonomyChangeDecisionReport,
  AutonomyChangeDecisionSummary,
} from "./aggregate-types.js";

export function buildAutonomyChangeDecisionReport(args: {
  runs: readonly WorkflowRunMetadata[];
  runsDir: string;
}): AutonomyChangeDecisionReport {
  const decisions: AutonomyChangeDecisionSummary[] = [];
  const invalidArtifacts: AutonomyChangeDecisionReport["invalidArtifacts"] = [];

  for (const run of args.runs) {
    const path = join(args.runsDir, run.id, AUTONOMY_CHANGE_DECISION_ARTIFACT);
    const read = readAutonomyChangeDecisionArtifact(path);
    if (read.kind === "missing") continue;
    if (read.kind === "invalid") {
      invalidArtifacts.push({ runId: run.id, path, reason: read.reason });
      continue;
    }
    const artifact = read.artifact;
    decisions.push({
      runId: artifact.runId || run.id,
      createdAt: artifact.createdAt,
      taskIds: artifact.taskIds,
      affectedSurfaces: artifact.affectedSurfaces,
      changeClasses: artifact.changeClasses,
      baselineRefs: artifact.baselineRefs,
      candidateRefs: artifact.candidateRefs,
      metricsCompared: artifact.metricsCompared,
      rolloutMode: artifact.rolloutMode,
      decision: artifact.decision,
      rationale: artifact.rationale,
      ownerSafetyExceptions: artifact.ownerSafetyExceptions,
      followUpTaskIds: artifact.followUpTaskIds,
    });
  }

  decisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  invalidArtifacts.sort((a, b) => a.runId.localeCompare(b.runId));
  return {
    totalDecisions: decisions.length,
    invalidArtifacts,
    decisions,
  };
}
