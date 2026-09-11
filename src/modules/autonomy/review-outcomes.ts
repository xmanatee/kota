import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { CRITIC_REVIEW_ARTIFACT, decodeCriticVerdict } from "./critic-verdict.js";
import {
  isApprovalLikeDecision,
  isJsonObject,
  type JsonObject,
  type JsonValue,
  numberValue,
  type ReviewOutcomeRecord,
  type ReviewOutcomeReport,
  type ReviewOutcomeUnsupportedArtifact,
  type ReviewSurface,
  SEMANTIC_GATE_REVIEW_ARTIFACT,
  SUPPORTED_REVIEW_SURFACES,
  stringValue,
} from "./review-outcomes-types.js";
import { taskIdentityFromRunTrigger } from "./run-delivery-evidence.js";
import { PROGRESS_REVIEW_ARTIFACT } from "./workflows/progress-reviewer/progress-review/constants.js";

export type { ReviewDecision, ReviewOutcomeRecord, ReviewOutcomeReport, ReviewOutcomeUnsupportedArtifact, ReviewSurface } from "./review-outcomes-types.js";

/** Project original verdicts for inspection; review prose is never a quality score. */
export function collectReviewOutcomeReport(args: {
  runsDir: string;
  runs: readonly WorkflowRunMetadata[];
}): ReviewOutcomeReport {
  const records: ReviewOutcomeRecord[] = [];
  const unsupported: ReviewOutcomeUnsupportedArtifact[] = [];
  for (const run of args.runs) {
    for (const [artifact, surface] of [
      [CRITIC_REVIEW_ARTIFACT, "critic"],
      [SEMANTIC_GATE_REVIEW_ARTIFACT, "semantic-gate"],
      [PROGRESS_REVIEW_ARTIFACT, "progress-reviewer"],
    ] as const) {
      const path = join(args.runsDir, run.id, artifact);
      if (!existsSync(path)) continue;
      try {
        const text = readFileSync(path, "utf8");
        const value: JsonValue = JSON.parse(text);
        if (!isJsonObject(value)) throw new Error("Review artifact must be an object");
        const decision = surface === "progress-reviewer"
          ? progressDecision(value) : decodeCriticVerdict(value).verdict;
        records.push({
          surface, artifact, runId: run.id, workflow: run.workflow, decision,
          generatedAt: stringValue(value.generatedAt) ?? run.completedAt ?? run.startedAt,
          taskId: taskIdentityFromRunTrigger(run).taskId ?? undefined,
          reviewerPromptHash: stringValue(value.reviewerPromptHash) ?? undefined,
        });
      } catch (error) {
        unsupported.push({ runId: run.id, workflow: run.workflow, artifact,
          reason: error instanceof Error ? error.message : String(error) });
      }
    }
    if (run.workflow !== "pr-reviewer") continue;
    const step = run.steps.find((candidate) => candidate.id === "prepare-comment" && candidate.status === "success");
    if (!step) continue;
    const value = step.output as JsonValue | undefined;
    const repo = isJsonObject(value) ? stringValue(value.repo) : null;
    const number = isJsonObject(value) ? numberValue(value.prNumber) : null;
    const decision = isJsonObject(value) ? stringValue(value.recommendation) : null;
    if (!repo || number === null || (decision !== "approve" && decision !== "request-changes")) {
      unsupported.push({ runId: run.id, workflow: run.workflow, artifact: "metadata:prepare-comment", reason: "Invalid prepared review outcome" });
      continue;
    }
    records.push({ surface: "pr-reviewer", artifact: "metadata:prepare-comment", runId: run.id,
      workflow: run.workflow, generatedAt: step.completedAt, pr: { repo, number }, decision });
  }
  return {
    totalReviews: records.length,
    approvalLikeDecisions: records.filter((record) => isApprovalLikeDecision(record.decision)).length,
    unsupportedArtifacts: unsupported.length,
    bySurface: SUPPORTED_REVIEW_SURFACES.map((surface) => ({
      surface,
      reviews: records.filter((record) => record.surface === surface).length,
      approvalLikeDecisions: records.filter((record) => record.surface === surface && isApprovalLikeDecision(record.decision)).length,
      unsupportedArtifacts: unsupported.filter((record) => surfaceForArtifact(record.artifact) === surface).length,
    })),
    records, unsupported,
  };
}

function progressDecision(value: JsonObject): ReviewOutcomeRecord["decision"] {
  const verdict = isJsonObject(value.review) ? value.review.verdict : undefined;
  if (verdict === "on-track" || verdict === "needs-steering" || verdict === "blocked" || verdict === "insufficient-evidence") return verdict;
  throw new Error("Invalid progress review outcome");
}

function surfaceForArtifact(artifact: string): ReviewSurface {
  if (artifact === CRITIC_REVIEW_ARTIFACT) return "critic";
  if (artifact === SEMANTIC_GATE_REVIEW_ARTIFACT) return "semantic-gate";
  if (artifact === PROGRESS_REVIEW_ARTIFACT) return "progress-reviewer";
  return "pr-reviewer";
}
