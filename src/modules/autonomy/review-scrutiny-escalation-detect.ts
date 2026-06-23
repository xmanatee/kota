import {
  listFullRepoTasks,
  type RepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";
import { collectReviewScrutinyReport } from "./review-scrutiny-collect.js";
import {
  escalationThresholds,
  normalizeReviewScrutinyEscalationConfig,
  REVIEW_SCRUTINY_TASK_ID_PREFIX,
  type ReviewScrutinyEscalationConfig,
  type ReviewScrutinyEscalationDetection,
  type ReviewScrutinyEscalationThresholds,
  type ReviewScrutinyEvidenceRef,
  type ReviewScrutinyPatternCandidate,
  shortHash,
  stableHash,
} from "./review-scrutiny-escalation-types.js";
import {
  isApprovalLikeDecision,
  type ReviewDecision,
  type ReviewScrutinyRecord,
  type ReviewScrutinyReport,
} from "./review-scrutiny-types.js";

function taskContext(
  record: ReviewScrutinyRecord,
  taskById: Map<string, RepoTaskFullRecord>,
) {
  const task = record.taskId ? taskById.get(record.taskId) : undefined;
  return {
    taskArea: task?.area || "(unknown)",
    taskClass: task?.taskClass ?? "Unclassified",
  };
}

function artifactPath(record: ReviewScrutinyRecord): string {
  if (record.artifact.startsWith("metadata:")) {
    return `.kota/runs/${record.runId}/metadata.json#${record.artifact.slice("metadata:".length)}`;
  }
  return `.kota/runs/${record.runId}/${record.artifact}`;
}

function groupKey(
  record: ReviewScrutinyRecord,
  taskById: Map<string, RepoTaskFullRecord>,
): string {
  const context = taskContext(record, taskById);
  return [record.surface, record.workflow, context.taskArea, context.taskClass].join("\0");
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function belowThresholdReason(
  candidate: Pick<
    ReviewScrutinyPatternCandidate,
    "approvalLikeDecisions" | "thinAcceptances" | "thinAcceptanceRatio"
  >,
  thresholds: ReviewScrutinyEscalationThresholds,
): string | null {
  const reasons: string[] = [];
  if (candidate.approvalLikeDecisions < thresholds.minApprovalLikeDecisions) {
    reasons.push(
      `${candidate.approvalLikeDecisions}/${thresholds.minApprovalLikeDecisions} approval-like decisions`,
    );
  }
  if (candidate.thinAcceptances < thresholds.minThinAcceptances) {
    reasons.push(
      `${candidate.thinAcceptances}/${thresholds.minThinAcceptances} thin acceptances`,
    );
  }
  if (candidate.thinAcceptanceRatio < thresholds.minThinAcceptanceRatio) {
    reasons.push(
      `${candidate.thinAcceptanceRatio.toFixed(2)}/${thresholds.minThinAcceptanceRatio.toFixed(2)} ratio`,
    );
  }
  return reasons.length > 0 ? `below threshold: ${reasons.join(", ")}` : null;
}

function evidenceForThinRecords(
  records: ReviewScrutinyRecord[],
): ReviewScrutinyEvidenceRef[] {
  return records.map((record) => ({
    runId: record.runId,
    workflow: record.workflow,
    surface: record.surface,
    decision: record.decision,
    artifactPath: artifactPath(record),
    signals: record.signals,
    absentMetrics: record.absentMetrics,
    ...(record.taskId ? { taskId: record.taskId } : {}),
    ...(record.pr ? { pr: record.pr } : {}),
  }));
}

function buildCandidate(
  records: ReviewScrutinyRecord[],
  taskById: Map<string, RepoTaskFullRecord>,
  thresholds: ReviewScrutinyEscalationThresholds,
): ReviewScrutinyPatternCandidate | null {
  const approvalLike = records.filter((record) => isApprovalLikeDecision(record.decision));
  const thin = approvalLike.filter((record) => record.thinAcceptance);
  if (approvalLike.length === 0 || thin.length === 0) return null;
  const first = approvalLike[0]!;
  const context = taskContext(first, taskById);
  const chronologicalThin = [...thin].sort(
    (a, b) =>
      Date.parse(a.generatedAt) - Date.parse(b.generatedAt) ||
      a.runId.localeCompare(b.runId),
  );
  const fingerprint = [
    "review-scrutiny",
    first.surface,
    first.workflow,
    context.taskArea,
    context.taskClass,
  ].join(":");
  const evidence = evidenceForThinRecords(chronologicalThin);
  const runIds = uniqueSorted(thin.map((record) => record.runId));
  const taskIds = uniqueSorted(
    thin.map((record) => record.taskId).filter((id): id is string => Boolean(id)),
  );
  const artifactPaths = uniqueSorted(evidence.map((ref) => ref.artifactPath));
  const decisions = uniqueSorted(thin.map((record) => record.decision));
  const ratio = thin.length / approvalLike.length;
  const candidate = {
    surface: first.surface,
    workflow: first.workflow,
    taskArea: context.taskArea,
    taskClass: context.taskClass,
    approvalLikeDecisions: approvalLike.length,
    thinAcceptances: thin.length,
    thinAcceptanceRatio: ratio,
    absentMetricCount: approvalLike.reduce(
      (total, record) => total + record.absentMetrics.length,
      0,
    ),
    fingerprint,
    evidenceFingerprint: stableHash(
      JSON.stringify({ fingerprint, runIds, taskIds, artifactPaths, decisions }),
    ),
    taskId: `${REVIEW_SCRUTINY_TASK_ID_PREFIX}${shortHash(fingerprint)}`,
    runIds,
    taskIds,
    artifactPaths,
    decisions: decisions as ReviewDecision[],
    windowStart: chronologicalThin[0]?.generatedAt ?? "",
    windowEnd: chronologicalThin[chronologicalThin.length - 1]?.generatedAt ?? "",
    evidence,
    reason:
      `${first.surface} produced ${thin.length}/${approvalLike.length} thin approval-like ` +
      `decisions for ${first.workflow} ${context.taskArea}/${context.taskClass}.`,
    belowThresholdReason: null,
  };
  return {
    ...candidate,
    belowThresholdReason: belowThresholdReason(candidate, thresholds),
  };
}

function compareCandidates(
  a: ReviewScrutinyPatternCandidate,
  b: ReviewScrutinyPatternCandidate,
): number {
  return (
    b.thinAcceptances - a.thinAcceptances ||
    b.approvalLikeDecisions - a.approvalLikeDecisions ||
    b.thinAcceptanceRatio - a.thinAcceptanceRatio ||
    a.surface.localeCompare(b.surface) ||
    a.workflow.localeCompare(b.workflow) ||
    a.taskArea.localeCompare(b.taskArea) ||
    a.taskClass.localeCompare(b.taskClass)
  );
}

export function detectRecurringReviewScrutinyPatternsFromReport(args: {
  report: ReviewScrutinyReport;
  tasks: readonly RepoTaskFullRecord[];
  config?: ReviewScrutinyEscalationConfig;
}): ReviewScrutinyEscalationDetection {
  const normalized = normalizeReviewScrutinyEscalationConfig(args.config);
  const windowStartMs = normalized.nowMs - normalized.windowMs;
  const thresholds = escalationThresholds(normalized);
  const taskById = new Map(args.tasks.map((task) => [task.id, task]));
  const grouped = new Map<string, ReviewScrutinyRecord[]>();
  for (const record of args.report.records) {
    const generatedAtMs = Date.parse(record.generatedAt);
    if (
      !Number.isFinite(generatedAtMs) ||
      generatedAtMs < windowStartMs ||
      generatedAtMs > normalized.nowMs ||
      !isApprovalLikeDecision(record.decision)
    ) {
      continue;
    }
    const key = groupKey(record, taskById);
    const list = grouped.get(key) ?? [];
    list.push(record);
    grouped.set(key, list);
  }
  const candidates = [...grouped.values()]
    .map((records) => buildCandidate(records, taskById, thresholds))
    .filter((candidate): candidate is ReviewScrutinyPatternCandidate => candidate !== null);
  return {
    thresholds,
    patterns: candidates
      .filter((candidate) => candidate.belowThresholdReason === null)
      .sort(compareCandidates),
    belowThreshold: candidates
      .filter((candidate) => candidate.belowThresholdReason !== null)
      .sort(compareCandidates),
    unsupportedArtifacts: args.report.unsupportedArtifacts,
  };
}

export function detectRecurringReviewScrutinyPatterns(
  projectDir: string,
  runsDir: string,
  config?: ReviewScrutinyEscalationConfig,
): ReviewScrutinyEscalationDetection {
  const normalized = normalizeReviewScrutinyEscalationConfig(config);
  const cutoffMs = normalized.nowMs - normalized.windowMs;
  const runs = loadRunsInWindow(runsDir, cutoffMs).filter((run) => {
    const startedAtMs = Date.parse(run.startedAt);
    return Number.isFinite(startedAtMs) && startedAtMs <= normalized.nowMs;
  });
  const report = collectReviewScrutinyReport({ runsDir, runs });
  return detectRecurringReviewScrutinyPatternsFromReport({
    report,
    tasks: listFullRepoTasks(projectDir),
    config: normalized,
  });
}
