import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { enumerateWorkflowRunMetadataWithDurableAuthority } from "#core/workflow/run-operational-projection.js";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import {
  WRITER_INTEGRATION_EVIDENCE,
  type WriterIntegrationEvidence,
} from "#core/workflow/writer-integration-evidence.js";
import {
  listVerifiedFullRepoTasks,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { securityReviewSurfacesForChangedPath } from "./security-review-file-scan.js";
import {
  SECURITY_REVIEW_MAX_DUE_PATHS,
  type SecurityReviewSurface,
} from "./security-review-scan-model.js";

export const SECURITY_REVIEW_DUE_EVENT = "autonomy.security-review.due";
export const SECURITY_REVIEW_ROUTINE_COOLDOWN_MS = 60 * 60 * 1000;

const SOURCE_CODE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);

export type SecurityReviewGitHead =
  | { kind: "commit"; sha: string }
  | { kind: "unavailable"; reason: string };

export type SecurityReviewTimestamp =
  | { kind: "timestamp"; value: string; epochMs: number }
  | { kind: "unavailable"; reason: string };

export type SecurityReviewLastEvidence =
  | { kind: "none" }
  | {
      kind: "found";
      runId: string;
      runDir: string;
      workflow: string;
      outcome: string;
      completedAt: SecurityReviewTimestamp;
      head: SecurityReviewGitHead;
    };

export type SecurityReviewComparison =
  | { kind: "commit-range"; baseSha: string; headSha: string }
  | { kind: "since-time"; since: string }
  | { kind: "full-tree"; reason: "no-review-evidence" | "missing-review-baseline" }
  | { kind: "unavailable"; reason: string };

export type SecurityReviewChangedSurface = {
  surface: SecurityReviewSurface;
  paths: string[];
};

export type SecurityReviewOpenTask = {
  id: string;
  title: string;
  state: RepoTaskState;
  path: string;
};

export type SecurityReviewCooldown = {
  elapsedMs: number;
  remainingMs: number;
};

export type SecurityReviewDueReason =
  | "no-review-evidence"
  | "security-sensitive-change"
  | "high-risk-security-sensitive-change"
  | "no-security-sensitive-change"
  | "open-security-task-pressure"
  | "cooldown-active"
  | "git-unavailable";

export type SecurityReviewDueDecision = {
  due: boolean;
  reason: SecurityReviewDueReason;
  currentHead: SecurityReviewGitHead;
  lastReview: SecurityReviewLastEvidence;
  comparison: SecurityReviewComparison;
  changedSurfaces: SecurityReviewChangedSurface[];
  changedPathCount: number;
  highRiskChangedPaths: string[];
  openSecurityTasks: SecurityReviewOpenTask[];
  cooldownMs: number;
  cooldown: SecurityReviewCooldown;
};

export type SecurityReviewDuePayload = {
  due: boolean;
  reason: SecurityReviewDueReason;
  currentHead: SecurityReviewGitHead;
  lastReview: SecurityReviewLastEvidence;
  comparison: SecurityReviewComparison;
  changedPaths: string[];
  changedPathCount: number;
  changedSurfaceCounts: Array<{ surface: SecurityReviewSurface; pathCount: number }>;
  highRiskChangedPathCount: number;
  openSecurityTaskCount: number;
  cooldownMs: number;
  cooldown: SecurityReviewCooldown;
};

export type InspectSecurityReviewDueOptions = {
  cooldownMs?: number;
  now?: Date;
  stateDir: string;
};

export type SecurityReviewGitEvidence = {
  currentHead: SecurityReviewGitHead;
  lastReview: SecurityReviewLastEvidence;
  comparison: SecurityReviewComparison;
  changedPaths: string[];
};

type RunMetadataJson = {
  id?: string;
  workflow?: string;
  status?: string;
  completedAt?: string;
};

type SecurityReviewOutcomeJson = {
  outcome?: string;
  reason?: string;
};

type SecurityReviewChangedPathClassification = {
  path: string;
  surfaces: SecurityReviewSurface[];
};

function outputLines(output: string): string[] {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function tryGitLines(
  runCommand: WorkflowCommandRunner,
  workspaceRoot: string,
  args: readonly string[],
): Promise<string[] | null> {
  try {
    const result = await runCommand({
      command: "git",
      args,
      cwd: workspaceRoot,
      captureLimitBytesPerStream: 1_000_000,
    });
    return outputLines(result.stdout.text);
  } catch {
    return null;
  }
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function parseTimestamp(value: string | undefined): SecurityReviewTimestamp {
  if (!value) {
    return { kind: "unavailable", reason: "missing-completed-at" };
  }
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) {
    return { kind: "unavailable", reason: "invalid-completed-at" };
  }
  return { kind: "timestamp", value, epochMs };
}

function extractRecordedCommitHead(runDirPath: string): SecurityReviewGitHead {
  const integration = readJsonFile<WriterIntegrationEvidence>(
    join(runDirPath, WRITER_INTEGRATION_EVIDENCE),
  );
  if (integration?.publishedHead) {
    return { kind: "commit", sha: integration.publishedHead };
  }

  return { kind: "unavailable", reason: "review-commit-unavailable" };
}

function outcomeLabel(outcome: SecurityReviewOutcomeJson | null): string {
  if (!outcome) return "unknown";
  if (outcome.reason) return outcome.reason;
  return outcome.outcome ?? "unknown";
}

function findLastSecurityReviewEvidence(
  stateDir: string,
  scopeRoot: string,
): SecurityReviewLastEvidence {
  const runsDir = join(stateDir, "runs");
  if (!existsSync(runsDir)) return { kind: "none" };

  const candidates: Array<{
    runId: string;
    runDirPath: string;
    metadata: RunMetadataJson;
    outcome: SecurityReviewOutcomeJson | null;
    completedAt: SecurityReviewTimestamp;
    sortMs: number;
  }> = [];

  for (const runMetadata of enumerateWorkflowRunMetadataWithDurableAuthority({
    runsDir,
    stateDir,
    scopeRoot,
  }).runs) {
    const runId = runMetadata.id;
    const runDirPath = join(runsDir, runId);
    const outcomePath = join(runDirPath, "security-review-outcome.json");
    const candidatesPath = join(runDirPath, "security-review-candidates.json");
    if (!existsSync(outcomePath) && !existsSync(candidatesPath)) continue;

    const metadata: RunMetadataJson = runMetadata;
    if (metadata.status && metadata.status !== "success") continue;
    const outcome = readJsonFile<SecurityReviewOutcomeJson>(outcomePath);
    const completedAt = parseTimestamp(metadata.completedAt);
    candidates.push({
      runId,
      runDirPath,
      metadata,
      outcome,
      completedAt,
      sortMs:
        completedAt.kind === "timestamp"
          ? completedAt.epochMs
          : statSync(runDirPath).mtimeMs,
    });
  }

  const last = candidates.sort((a, b) => b.sortMs - a.sortMs || b.runId.localeCompare(a.runId))[0];
  if (!last) return { kind: "none" };

  return {
    kind: "found",
    runId: last.runId,
    runDir: `.kota/runs/${last.runId}`,
    workflow: last.metadata.workflow ?? "unknown",
    outcome: outcomeLabel(last.outcome),
    completedAt: last.completedAt,
    head: extractRecordedCommitHead(last.runDirPath),
  };
}

function buildComparison(
  currentHead: SecurityReviewGitHead,
  lastReview: SecurityReviewLastEvidence,
): SecurityReviewComparison {
  if (currentHead.kind !== "commit") {
    return { kind: "unavailable", reason: currentHead.reason };
  }
  if (lastReview.kind === "none") {
    return { kind: "full-tree", reason: "no-review-evidence" };
  }
  if (lastReview.head.kind === "commit") {
    return {
      kind: "commit-range",
      baseSha: lastReview.head.sha,
      headSha: currentHead.sha,
    };
  }
  if (lastReview.completedAt.kind === "timestamp") {
    return { kind: "since-time", since: lastReview.completedAt.value };
  }
  return { kind: "full-tree", reason: "missing-review-baseline" };
}

async function changedPathsForComparison(
  runCommand: WorkflowCommandRunner,
  workspaceRoot: string,
  comparison: SecurityReviewComparison,
): Promise<string[]> {
  if (comparison.kind === "unavailable") return [];
  const gitArgs = (() => {
    if (comparison.kind === "commit-range") {
      return [
        "diff",
        "--name-only",
        `${comparison.baseSha}..${comparison.headSha}`,
        "--",
      ];
    }
    if (comparison.kind === "since-time") {
      return [
        "log",
        "--format=",
        "--name-only",
        `--since=${comparison.since}`,
        "--",
      ];
    }
    return ["ls-files"];
  })();
  const paths = await tryGitLines(runCommand, workspaceRoot, gitArgs);

  return Array.from(new Set(paths ?? [])).sort();
}

export async function collectSecurityReviewGitEvidence(args: {
  workspaceRoot: string;
  scopeRoot: string;
  stateDir: string;
  runCommand: WorkflowCommandRunner;
}): Promise<SecurityReviewGitEvidence> {
  const headLines = await tryGitLines(args.runCommand, args.workspaceRoot, [
    "rev-parse",
    "HEAD",
  ]);
  const currentHead: SecurityReviewGitHead = headLines?.[0]
    ? { kind: "commit", sha: headLines[0] }
    : { kind: "unavailable", reason: "git-head-unavailable" };
  const recordedReview = findLastSecurityReviewEvidence(
    args.stateDir,
    args.scopeRoot,
  );
  const lastReview =
    recordedReview.kind === "found" && recordedReview.head.kind === "commit" &&
      (await tryGitLines(args.runCommand, args.workspaceRoot, [
        "cat-file",
        "-e",
        `${recordedReview.head.sha}^{commit}`,
      ])) === null
      ? {
          ...recordedReview,
          head: {
            kind: "unavailable",
            reason: "review-commit-unavailable",
          } as const,
        }
      : recordedReview;
  const comparison = buildComparison(currentHead, lastReview);
  const changedPaths = await changedPathsForComparison(
    args.runCommand,
    args.workspaceRoot,
    comparison,
  );
  return { currentHead, lastReview, comparison, changedPaths };
}

function classifyChangedPaths(
  workspaceRoot: string,
  paths: readonly string[],
): SecurityReviewChangedPathClassification[] {
  return paths.map((path) => ({
    path,
    surfaces: securityReviewSurfacesForChangedPath(workspaceRoot, path),
  }));
}

function changedSurfacesForPaths(
  classifications: readonly SecurityReviewChangedPathClassification[],
): SecurityReviewChangedSurface[] {
  const bySurface = new Map<SecurityReviewSurface, string[]>();
  for (const classification of classifications) {
    for (const surface of classification.surfaces) {
      const existing = bySurface.get(surface) ?? [];
      existing.push(classification.path);
      bySurface.set(surface, existing);
    }
  }
  return Array.from(bySurface.entries())
    .map(([surface, surfacePaths]) => ({
      surface,
      paths: Array.from(new Set(surfacePaths)).sort(),
    }))
    .sort((a, b) => a.surface.localeCompare(b.surface));
}

function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|test|tests)\//.test(path) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function isHighRiskChangedPath(classification: SecurityReviewChangedPathClassification): boolean {
  return SOURCE_CODE_EXTENSIONS.has(extname(classification.path)) &&
    !isTestPath(classification.path) &&
    classification.surfaces.length > 0;
}

function taskLooksLikeSecurityReviewFollowUp(id: string, body: string): boolean {
  return id.startsWith("task-security-review-") ||
    body.includes("Created by security-review workflow run ");
}

function listOpenSecurityReviewTasks(workspaceRoot: string): SecurityReviewOpenTask[] {
  return listVerifiedFullRepoTasks(workspaceRoot, ["open", "blocked"])
    .filter((task) => taskLooksLikeSecurityReviewFollowUp(task.id, task.body))
    .map((task) => ({
      id: task.id,
      title: task.title,
      state: task.state,
      path: task.taskFile.path,
    }));
}

function computeCooldown(
  lastReview: SecurityReviewLastEvidence,
  nowMs: number,
  cooldownMs: number,
): SecurityReviewCooldown {
  if (lastReview.kind === "none" || lastReview.completedAt.kind !== "timestamp") {
    return { elapsedMs: Number.MAX_SAFE_INTEGER, remainingMs: 0 };
  }
  const elapsedMs = Math.max(0, nowMs - lastReview.completedAt.epochMs);
  return {
    elapsedMs,
    remainingMs: Math.max(0, cooldownMs - elapsedMs),
  };
}

function decideDue(args: {
  lastReview: SecurityReviewLastEvidence;
  comparison: SecurityReviewComparison;
  changedSurfaces: readonly SecurityReviewChangedSurface[];
  highRiskChangedPaths: readonly string[];
  openSecurityTasks: readonly SecurityReviewOpenTask[];
  cooldown: SecurityReviewCooldown;
}): { due: boolean; reason: SecurityReviewDueReason } {
  if (args.comparison.kind === "unavailable") {
    return { due: false, reason: "git-unavailable" };
  }
  if (args.changedSurfaces.length === 0) {
    return { due: false, reason: "no-security-sensitive-change" };
  }
  if (args.cooldown.remainingMs > 0) {
    return { due: false, reason: "cooldown-active" };
  }
  if (args.openSecurityTasks.length > 0 && args.highRiskChangedPaths.length === 0) {
    return { due: false, reason: "open-security-task-pressure" };
  }
  if (args.lastReview.kind === "none") {
    return { due: true, reason: "no-review-evidence" };
  }
  if (args.highRiskChangedPaths.length > 0) {
    return { due: true, reason: "high-risk-security-sensitive-change" };
  }
  return { due: true, reason: "security-sensitive-change" };
}

export function inspectSecurityReviewDue(
  workspaceRoot: string,
  options: InspectSecurityReviewDueOptions,
  git: SecurityReviewGitEvidence,
): SecurityReviewDueDecision {
  const cooldownMs = options.cooldownMs ?? SECURITY_REVIEW_ROUTINE_COOLDOWN_MS;
  const nowMs = (options.now ?? new Date()).getTime();
  const { currentHead, lastReview, comparison, changedPaths } = git;
  const changedPathClassifications = classifyChangedPaths(workspaceRoot, changedPaths);
  const changedSurfaces = changedSurfacesForPaths(changedPathClassifications);
  const highRiskChangedPaths = changedPathClassifications
    .filter(isHighRiskChangedPath)
    .map((classification) => classification.path);
  const openSecurityTasks = listOpenSecurityReviewTasks(workspaceRoot);
  const cooldown = computeCooldown(lastReview, nowMs, cooldownMs);
  const decision = decideDue({
    lastReview,
    comparison,
    changedSurfaces,
    highRiskChangedPaths,
    openSecurityTasks,
    cooldown,
  });

  return {
    ...decision,
    currentHead,
    lastReview,
    comparison,
    changedSurfaces,
    changedPathCount: changedPaths.length,
    highRiskChangedPaths,
    openSecurityTasks,
    cooldownMs,
    cooldown,
  };
}

export function buildSecurityReviewDuePayload(
  decision: SecurityReviewDueDecision,
): SecurityReviewDuePayload {
  const orderedPaths = [
    ...decision.highRiskChangedPaths,
    ...decision.changedSurfaces.flatMap((surface) => surface.paths),
  ];
  return {
    due: decision.due,
    reason: decision.reason,
    currentHead: decision.currentHead,
    lastReview: decision.lastReview,
    comparison: decision.comparison,
    changedPaths: [...new Set(orderedPaths)].slice(0, SECURITY_REVIEW_MAX_DUE_PATHS),
    changedPathCount: decision.changedPathCount,
    changedSurfaceCounts: decision.changedSurfaces.map((surface) => ({
      surface: surface.surface,
      pathCount: surface.paths.length,
    })),
    highRiskChangedPathCount: decision.highRiskChangedPaths.length,
    openSecurityTaskCount: decision.openSecurityTasks.length,
    cooldownMs: decision.cooldownMs,
    cooldown: decision.cooldown,
  };
}
