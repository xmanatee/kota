import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  isApprovalLikeDecision,
  PROGRESS_REVIEW_ARTIFACT,
  REVIEW_SCRUTINY_ARTIFACT,
  REVIEW_SCRUTINY_METRICS,
  REVIEW_SCRUTINY_SCHEMA_VERSION,
  type ReviewScrutinyMetric,
  type ReviewScrutinyRecord,
  type ReviewScrutinySignals,
  SEMANTIC_GATE_REVIEW_ARTIFACT,
} from "./review-scrutiny-types.js";

const CRITIC_METRICS: ReviewScrutinyMetric[] = [
  "issueCount",
  "warningCount",
  "reviewBodyLength",
];
const PROGRESS_REVIEW_METRICS: ReviewScrutinyMetric[] = [
  "evidenceIdCount",
  "findingCount",
  "issueCount",
  "followUpTaskCount",
  "reviewBodyLength",
];
const PR_REVIEW_METRICS: ReviewScrutinyMetric[] = [
  "reviewBodyLength",
  "citedFileLineCount",
];

function measuredSignals(
  metrics: readonly ReviewScrutinyMetric[],
  values: ReviewScrutinySignals,
): ReviewScrutinySignals {
  const signals: ReviewScrutinySignals = {};
  for (const metric of metrics) {
    signals[metric] = values[metric] ?? 0;
  }
  return signals;
}

function absentMetrics(metrics: readonly ReviewScrutinyMetric[]): ReviewScrutinyMetric[] {
  const measured = new Set(metrics);
  return REVIEW_SCRUTINY_METRICS.filter((metric) => !measured.has(metric));
}

function hasScrutinySignal(signals: ReviewScrutinySignals): boolean {
  return (
    (signals.evidenceIdCount ?? 0) > 0 ||
    (signals.findingCount ?? 0) > 0 ||
    (signals.issueCount ?? 0) > 0 ||
    (signals.warningCount ?? 0) > 0 ||
    (signals.followUpTaskCount ?? 0) > 0 ||
    (signals.citedFileLineCount ?? 0) > 0
  );
}

function withThinFlag(
  args: Omit<ReviewScrutinyRecord, "thinAcceptance">,
): ReviewScrutinyRecord {
  return {
    ...args,
    thinAcceptance:
      isApprovalLikeDecision(args.decision) && !hasScrutinySignal(args.signals),
  };
}

export function buildCriticReviewScrutinyRecord(args: {
  runId: string;
  workflow: string;
  generatedAt: string;
  artifact: string;
  taskId?: string;
  verdict: {
    verdict: "pass" | "fail" | "pass_with_warnings";
    critical_issues: readonly string[];
    warnings: readonly string[];
    summary: string;
  };
}): ReviewScrutinyRecord {
  return withThinFlag({
    schemaVersion: REVIEW_SCRUTINY_SCHEMA_VERSION,
    surface:
      args.artifact === SEMANTIC_GATE_REVIEW_ARTIFACT ? "semantic-gate" : "critic",
    runId: args.runId,
    workflow: args.workflow,
    generatedAt: args.generatedAt,
    artifact: args.artifact,
    ...(args.taskId ? { taskId: args.taskId } : {}),
    decision: args.verdict.verdict,
    signals: measuredSignals(CRITIC_METRICS, {
      issueCount: args.verdict.critical_issues.length,
      warningCount: args.verdict.warnings.length,
      reviewBodyLength: args.verdict.summary.length,
    }),
    absentMetrics: absentMetrics(CRITIC_METRICS),
  });
}

export function buildProgressReviewScrutinyRecordFromReview(args: {
  runId: string;
  workflow: string;
  generatedAt: string;
  taskId?: string;
  decision: "on-track" | "needs-steering" | "blocked" | "insufficient-evidence";
  summary: string;
  findingGroups: readonly {
    claims: readonly { evidenceIds: readonly string[] }[];
    followUpTasks: readonly { evidenceIds: readonly string[] }[];
  }[];
  ownerQuestions: readonly { evidenceIds: readonly string[] }[];
}): ReviewScrutinyRecord {
  const evidenceIds = new Set<string>();
  let findingCount = 0;
  let followUpTaskCount = 0;
  for (const group of args.findingGroups) {
    findingCount += group.claims.length;
    followUpTaskCount += group.followUpTasks.length;
    for (const claim of group.claims) {
      for (const id of claim.evidenceIds) evidenceIds.add(id);
    }
    for (const task of group.followUpTasks) {
      for (const id of task.evidenceIds) evidenceIds.add(id);
    }
  }
  for (const question of args.ownerQuestions) {
    for (const id of question.evidenceIds) evidenceIds.add(id);
  }
  return withThinFlag({
    schemaVersion: REVIEW_SCRUTINY_SCHEMA_VERSION,
    surface: "progress-reviewer",
    runId: args.runId,
    workflow: args.workflow,
    generatedAt: args.generatedAt,
    artifact: PROGRESS_REVIEW_ARTIFACT,
    ...(args.taskId ? { taskId: args.taskId } : {}),
    decision: args.decision,
    signals: measuredSignals(PROGRESS_REVIEW_METRICS, {
      evidenceIdCount: evidenceIds.size,
      findingCount,
      issueCount: args.ownerQuestions.length,
      followUpTaskCount,
      reviewBodyLength: args.summary.length,
    }),
    absentMetrics: absentMetrics(PROGRESS_REVIEW_METRICS),
  });
}

export function buildPrReviewScrutinyRecord(args: {
  runId: string;
  workflow: string;
  generatedAt: string;
  artifact: string;
  repo: string;
  prNumber: number;
  recommendation: "approve" | "request-changes";
  body: string;
}): ReviewScrutinyRecord {
  return withThinFlag({
    schemaVersion: REVIEW_SCRUTINY_SCHEMA_VERSION,
    surface: "pr-reviewer",
    runId: args.runId,
    workflow: args.workflow,
    generatedAt: args.generatedAt,
    artifact: args.artifact,
    pr: { repo: args.repo, number: args.prNumber },
    decision: args.recommendation,
    signals: measuredSignals(PR_REVIEW_METRICS, {
      reviewBodyLength: args.body.length,
      citedFileLineCount: countFileLineCitations(args.body),
    }),
    absentMetrics: absentMetrics(PR_REVIEW_METRICS),
  });
}

export function writeReviewScrutinyRecord(
  runDirPath: string,
  record: ReviewScrutinyRecord,
): string {
  mkdirSync(runDirPath, { recursive: true });
  const path = join(runDirPath, REVIEW_SCRUTINY_ARTIFACT);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
  return path;
}

function countFileLineCitations(text: string): number {
  const matches = text.match(/\b[\w./-]+\.[A-Za-z0-9]+(?::\d+|#L\d+)\b/g);
  return matches ? new Set(matches).size : 0;
}

export function runIdFromRunDir(runDirPath: string): string {
  return basename(runDirPath);
}
