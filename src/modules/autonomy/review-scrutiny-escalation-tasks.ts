import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  getRepoTaskStateDir,
  getRepoTasksDir,
  moveTaskById,
  REPO_TASK_STATES,
  writeRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { buildReviewScrutinyTaskBody } from "./review-scrutiny-escalation-task-body.js";
import {
  type ExistingReviewScrutinyTask,
  normalizeReviewScrutinyEscalationConfig,
  REVIEW_SCRUTINY_EVIDENCE_FINGERPRINT_RE,
  type ReviewScrutinyEscalationApplied,
  type ReviewScrutinyEscalationConfig,
  type ReviewScrutinyEscalationContext,
  type ReviewScrutinyEscalationProposal,
  type ReviewScrutinyPatternCandidate,
} from "./review-scrutiny-escalation-types.js";

function findExistingTask(
  projectDir: string,
  taskId: string,
): ExistingReviewScrutinyTask | null {
  const tasksDir = getRepoTasksDir(projectDir);
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
  projectDir: string,
  pattern: ReviewScrutinyPatternCandidate,
  config?: ReviewScrutinyEscalationConfig,
): ReviewScrutinyEscalationProposal {
  const normalized = normalizeReviewScrutinyEscalationConfig(config);
  const existing = findExistingTask(projectDir, pattern.taskId);
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

function taskTimestamps(
  existing: ExistingReviewScrutinyTask | null,
  nowIso: string,
): { createdAt: string; updatedAt: string } {
  return {
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

function buildReviewScrutinyTaskFile(
  pattern: ReviewScrutinyPatternCandidate,
  timestamps: { createdAt: string; updatedAt: string },
): string {
  return serializeFlatFrontMatter(
    {
      id: pattern.taskId,
      title: `Repair recurring thin ${pattern.surface} acceptances`,
      status: "ready",
      priority: "p2",
      area: "autonomy",
      task_class: "Meta",
      summary:
        `Make ${pattern.surface} reviews for ${pattern.workflow} ${pattern.taskArea}/${pattern.taskClass} ` +
        "carry inspectable evidence instead of recurring thin acceptances.",
      created_at: timestamps.createdAt,
      updated_at: timestamps.updatedAt,
    },
    buildReviewScrutinyTaskBody(pattern),
  );
}

function writeReadyTask(
  projectDir: string,
  pattern: ReviewScrutinyPatternCandidate,
  existing: ExistingReviewScrutinyTask | null,
  nowIso: string,
): string {
  const targetDir = getRepoTaskStateDir(projectDir, "ready");
  const targetPath = join(targetDir, `${pattern.taskId}.md`);
  writeRepoTaskFile(
    projectDir,
    targetPath,
    buildReviewScrutinyTaskFile(pattern, taskTimestamps(existing, nowIso)),
  );
  return targetPath;
}

export function applyReviewScrutinyEscalation(
  proposal: ReviewScrutinyEscalationProposal,
  ctx: ReviewScrutinyEscalationContext,
): ReviewScrutinyEscalationApplied {
  const { pattern } = proposal;
  if (proposal.action === "noop") {
    return {
      kind: "noop",
      taskId: pattern.taskId,
      patternFingerprint: pattern.fingerprint,
      reason: proposal.reason,
      suppression: proposal.suppression,
      ...(proposal.existingState ? { existingState: proposal.existingState } : {}),
    };
  }
  const existing = findExistingTask(ctx.projectDir, pattern.taskId);
  const targetPath = join(
    getRepoTaskStateDir(ctx.projectDir, "ready"),
    `${pattern.taskId}.md`,
  );
  if (proposal.action === "create" && existsSync(targetPath)) {
    throw new Error(`review-scrutiny-escalation: refusing to overwrite existing ${targetPath}`);
  }
  if (proposal.action === "refresh" && (!existing || existing.state !== "ready")) {
    throw new Error(`review-scrutiny-escalation: expected ${pattern.taskId} in ready/ for refresh`);
  }
  if (proposal.action === "create" || proposal.action === "refresh") {
    const written = writeReadyTask(ctx.projectDir, pattern, existing, ctx.nowIso);
    return {
      kind: proposal.action === "create" ? "created" : "refreshed",
      taskId: pattern.taskId,
      patternFingerprint: pattern.fingerprint,
      path: written.slice(ctx.projectDir.length + 1),
    };
  }
  if (proposal.action === "promote") {
    const move = moveTaskById(ctx.projectDir, pattern.taskId, "ready");
    const promoted = findExistingTask(ctx.projectDir, pattern.taskId);
    writeReadyTask(ctx.projectDir, pattern, promoted, ctx.nowIso);
    return {
      kind: "promoted",
      taskId: pattern.taskId,
      patternFingerprint: pattern.fingerprint,
      fromState: "backlog",
      path: move.path,
      previousPath: move.previousPath,
    };
  }
  const previousPath = join(
    getRepoTaskStateDir(ctx.projectDir, proposal.previousState),
    `${pattern.taskId}.md`,
  );
  if (!existsSync(previousPath)) {
    throw new Error(
      `review-scrutiny-escalation: expected ${pattern.taskId} in ${proposal.previousState}/ for recreate`,
    );
  }
  if (existsSync(targetPath)) {
    throw new Error(`review-scrutiny-escalation: refusing to overwrite existing ${targetPath}`);
  }
  const move = moveTaskById(ctx.projectDir, pattern.taskId, "ready");
  writeReadyTask(ctx.projectDir, pattern, existing, ctx.nowIso);
  return {
    kind: "recreated",
    taskId: pattern.taskId,
    patternFingerprint: pattern.fingerprint,
    previousState: proposal.previousState,
    path: move.path,
  };
}
