import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  getRepoTasksDir,
  REPO_TASK_STATES,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  type ExistingReviewScrutinyTask,
  normalizeReviewScrutinyEscalationConfig,
  REVIEW_SCRUTINY_EVIDENCE_FINGERPRINT_RE,
  type ReviewScrutinyEscalationConfig,
  type ReviewScrutinyEscalationProposal,
  type ReviewScrutinyPatternCandidate,
} from "./review-scrutiny-escalation-types.js";

function findExistingTask(
  workspaceRoot: string,
  taskId: string,
): ExistingReviewScrutinyTask | null {
  const tasksDir = getRepoTasksDir(workspaceRoot);
  for (const state of REPO_TASK_STATES) {
    const candidate = join(tasksDir, state, `${taskId}.md`);
    if (!existsSync(candidate)) continue;
    const content = readFileSync(candidate, "utf-8");
    const { attrs } = parseFlatFrontMatter(content);
    return {
      state,
      path: candidate,
      content,
      evidenceFingerprint:
        content.match(REVIEW_SCRUTINY_EVIDENCE_FINGERPRINT_RE)?.[1] ?? null,
      createdAt: typeof attrs.created_at === "string" ? attrs.created_at : null,
      updatedAt: typeof attrs.updated_at === "string" ? attrs.updated_at : null,
    };
  }
  return null;
}

export function proposeReviewScrutinyEscalation(
  workspaceRoot: string,
  pattern: ReviewScrutinyPatternCandidate,
  config?: ReviewScrutinyEscalationConfig,
): ReviewScrutinyEscalationProposal {
  const normalized = normalizeReviewScrutinyEscalationConfig(config);
  const existing = findExistingTask(workspaceRoot, pattern.taskId);
  if (!existing) return { action: "create", pattern, target: "ready" };
  if (existing.state === "doing" || existing.state === "blocked") {
    return {
      action: "noop",
      pattern,
      reason: `${pattern.taskId} is already in ${existing.state}/; leaving the in-flight repair alone.`,
      suppression: "in-flight",
      existingState: existing.state,
    };
  }
  if (
    existing.evidenceFingerprint === pattern.evidenceFingerprint &&
    existing.state !== "backlog"
  ) {
    return {
      action: "noop",
      pattern,
      reason: `${pattern.taskId} already records this review-scrutiny evidence in ${existing.state}/.`,
      suppression: "already-current",
      existingState: existing.state,
    };
  }
  const updatedAtMs = existing.updatedAt ? Date.parse(existing.updatedAt) : Number.NaN;
  if (
    Number.isFinite(updatedAtMs) &&
    normalized.nowMs - updatedAtMs < normalized.cooldownMs
  ) {
    return {
      action: "noop",
      pattern,
      reason: `${pattern.taskId} was updated inside the review-scrutiny escalation cooldown.`,
      suppression: "cooldown",
      existingState: existing.state,
    };
  }
  if (existing.state === "ready") {
    return {
      action: "refresh",
      pattern,
      target: "ready",
      previousEvidenceFingerprint: existing.evidenceFingerprint,
    };
  }
  if (existing.state === "backlog") {
    return {
      action: "promote",
      pattern,
      fromState: "backlog",
      target: "ready",
      previousEvidenceFingerprint: existing.evidenceFingerprint,
    };
  }
  return {
    action: "recreate",
    pattern,
    previousState: existing.state,
    target: "ready",
    previousEvidenceFingerprint: existing.evidenceFingerprint,
  };
}
