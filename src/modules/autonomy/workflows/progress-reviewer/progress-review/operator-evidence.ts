import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PendingApproval } from "#core/daemon/approval-queue.js";
import {
  type DeadLetterItem,
  deadLetterRunArtifactIds,
  deadLetterStoreForScope,
} from "#core/daemon/dead-letter-queue.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  PROGRESS_REVIEW_MAX_APPROVALS,
  PROGRESS_REVIEW_MAX_DEAD_LETTERS,
} from "./constants.js";
import { sourceEvidenceId, sourceSummary } from "./trigger-target.js";
import type {
  OwnerQuestionFile,
  ProgressReviewApprovalEvidence,
  ProgressReviewDeadLetterCounts,
  ProgressReviewDeadLetterEvidence,
  ProgressReviewDirectorySource,
  ProgressReviewOwnerQuestionEvidence,
  ScopedApprovalEvidence,
  ScopedDeadLetterEvidence,
} from "./types.js";

function ownerQuestionActivityMs(item: OwnerQuestionFile): number | null {
  const timestamp = item.resolvedAt ?? item.createdAt;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function listOwnerQuestionEvidence(
  source: ProgressReviewDirectorySource,
  windowStartMs: number,
  excluded: string[],
): ProgressReviewOwnerQuestionEvidence[] {
  const dir = join(source.stateDir, "owner-questions");
  if (!existsSync(dir)) return [];
  const questions: ProgressReviewOwnerQuestionEvidence[] = [];
  for (const file of readdirSync(dir).sort().reverse()) {
    if (!file.endsWith(".json")) continue;
    const item = readOptionalJsonFile<OwnerQuestionFile>(join(dir, file));
    if (!item) continue;
    const activityMs = ownerQuestionActivityMs(item);
    if (activityMs === null || activityMs < windowStartMs) continue;
    questions.push({
      id: sourceEvidenceId(source, `owner-question:${item.id}`),
      kind: "owner-question",
      questionId: item.id,
      status: item.status,
      createdAt: item.createdAt,
      ...(item.resolvedAt ? { resolvedAt: item.resolvedAt } : {}),
      path: join(".kota", "owner-questions", file),
      summary: sourceSummary(source, `${item.status}: ${item.question}`),
    });
    if (questions.length >= 20) {
      excluded.push(`${source.displayName} owner questions: truncated after 20 recent questions`);
      break;
    }
  }
  return questions;
}

export function listScopedOwnerQuestionEvidence(
  sources: readonly ProgressReviewDirectorySource[],
  windowStartMs: number,
  excluded: string[],
): ProgressReviewOwnerQuestionEvidence[] {
  return sources.flatMap((source) =>
    listOwnerQuestionEvidence(source, windowStartMs, excluded),
  );
}

function approvalActivityMs(item: PendingApproval): number | null {
  const timestamp = item.resolvedAt ?? item.createdAt;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function approvalSummary(item: PendingApproval): string {
  const resolution =
    item.resolutionSource && item.resolutionSource.trim().length > 0
      ? ` by ${item.resolutionSource}`
      : "";
  return `${item.status}${resolution}: ${item.tool} (${item.risk}) - ${item.reason}`;
}

function summarizeApproval(
  source: ProgressReviewDirectorySource,
  file: string,
  item: PendingApproval,
): ProgressReviewApprovalEvidence {
  return {
    id: sourceEvidenceId(source, `approval:${item.id}`),
    kind: "approval",
    approvalId: item.id,
    status: item.status,
    tool: item.tool,
    risk: item.risk,
    reason: item.reason,
    createdAt: item.createdAt,
    ...(item.resolvedAt ? { resolvedAt: item.resolvedAt } : {}),
    ...(item.resolutionSource ? { resolutionSource: item.resolutionSource } : {}),
    path: join(".kota", "approvals", file),
    summary: sourceSummary(source, approvalSummary(item)),
  };
}

function listApprovalEvidence(
  source: ProgressReviewDirectorySource,
  windowStartMs: number,
): ScopedApprovalEvidence[] {
  const dir = join(source.stateDir, "approvals");
  if (!existsSync(dir)) return [];
  const approvals: ScopedApprovalEvidence[] = [];
  for (const file of readdirSync(dir).sort().reverse()) {
    if (!file.endsWith(".json")) continue;
    const item = readOptionalJsonFile<PendingApproval>(join(dir, file));
    if (!item) continue;
    const resolvedOrCreatedMs = approvalActivityMs(item);
    if (resolvedOrCreatedMs === null || resolvedOrCreatedMs < windowStartMs) continue;
    approvals.push({
      resolvedOrCreatedMs,
      evidence: summarizeApproval(source, file, item),
    });
  }
  return approvals;
}

export function listScopedApprovalEvidence(
  sources: readonly ProgressReviewDirectorySource[],
  windowStartMs: number,
  excluded: string[],
): ProgressReviewApprovalEvidence[] {
  const approvals = sources
    .flatMap((source) => listApprovalEvidence(source, windowStartMs))
    .sort(
      (a, b) =>
        b.resolvedOrCreatedMs - a.resolvedOrCreatedMs ||
        a.evidence.id.localeCompare(b.evidence.id),
    );
  if (approvals.length > PROGRESS_REVIEW_MAX_APPROVALS) {
    excluded.push(
      `approvals: truncated ${approvals.length} recent approvals to ${PROGRESS_REVIEW_MAX_APPROVALS}`,
    );
  }
  return approvals
    .slice(0, PROGRESS_REVIEW_MAX_APPROVALS)
    .map((approval) => approval.evidence);
}

function deadLetterQueuePath(stateDir: string): string {
  return join(stateDir, "dead-letter-queue", "items.json");
}

function emptyDeadLetterCounts(source: ProgressReviewDirectorySource): ProgressReviewDeadLetterCounts {
  return {
    scopeId: source.scopeId,
    path: join(".kota", "dead-letter-queue", "items.json"),
    open: 0,
    dismissed: 0,
    redriven: 0,
    openItemIds: [],
    redriveRunIds: [],
  };
}

export function listDeadLetterCounts(
  sources: readonly ProgressReviewDirectorySource[],
): ProgressReviewDeadLetterCounts[] {
  return sources.map((source) => {
    if (!existsSync(deadLetterQueuePath(source.stateDir))) {
      return emptyDeadLetterCounts(source);
    }
    const store = deadLetterStoreForScope(source.scopeRoot);
    const counts = store.counts(source.scopeId);
    const runArtifacts = deadLetterRunArtifactIds(source.scopeRoot, source.stateDir);
    return {
      scopeId: source.scopeId,
      path: join(".kota", "dead-letter-queue", "items.json"),
      ...counts,
      openItemIds: runArtifacts.itemIds,
      redriveRunIds: runArtifacts.runIds,
    };
  });
}

function deadLetterActivityMs(item: DeadLetterItem): number {
  const parsed = Date.parse(item.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deadLetterSummary(item: DeadLetterItem): string {
  const workflows =
    item.affectedWorkflowNames.length > 0
      ? ` for ${item.affectedWorkflowNames.join(", ")}`
      : "";
  return `${item.status} ${item.type}${workflows}: ${item.failure.reason}`;
}

function summarizeDeadLetter(
  source: ProgressReviewDirectorySource,
  item: DeadLetterItem,
): ProgressReviewDeadLetterEvidence {
  return {
    id: sourceEvidenceId(source, `dead-letter:${item.id}`),
    kind: "dead-letter",
    itemId: item.id,
    itemType: item.type,
    status: "open",
    failureClass: item.failure.lastErrorClass,
    reason: item.failure.reason,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    affectedWorkflowNames: item.affectedWorkflowNames,
    sourceEventIds: item.sourceEventIds,
    redriveAttemptCount: item.redriveAttempts.length,
    path: join(".kota", "dead-letter-queue", "items.json"),
    summary: sourceSummary(source, deadLetterSummary(item)),
  };
}

function listDeadLetterEvidence(
  source: ProgressReviewDirectorySource,
): ScopedDeadLetterEvidence[] {
  if (!existsSync(deadLetterQueuePath(source.stateDir))) return [];
  const store = deadLetterStoreForScope(source.scopeRoot);
  return store.list({ status: "open", scopeId: source.scopeId }).map((item) => ({
    updatedMs: deadLetterActivityMs(item),
    evidence: summarizeDeadLetter(source, item),
  }));
}

export function listScopedDeadLetterEvidence(
  sources: readonly ProgressReviewDirectorySource[],
  excluded: string[],
): ProgressReviewDeadLetterEvidence[] {
  const items = sources
    .flatMap((source) => listDeadLetterEvidence(source))
    .sort(
      (a, b) =>
        b.updatedMs - a.updatedMs ||
        a.evidence.id.localeCompare(b.evidence.id),
    );
  if (items.length > PROGRESS_REVIEW_MAX_DEAD_LETTERS) {
    excluded.push(
      `dead letters: truncated ${items.length} open items to ${PROGRESS_REVIEW_MAX_DEAD_LETTERS}`,
    );
  }
  return items
    .slice(0, PROGRESS_REVIEW_MAX_DEAD_LETTERS)
    .map((item) => item.evidence);
}
