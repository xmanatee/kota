import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import {
  getRepoTaskStateDir,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  type SecurityReviewSurface,
  securityReviewSurfacesForChangedPath,
} from "./security-review.js";

export const SECURITY_REVIEW_DUE_EVENT = "autonomy.security-review.due";
export const SECURITY_REVIEW_ROUTINE_COOLDOWN_MS = 60 * 60 * 1000;

const OPEN_SECURITY_TASK_STATES = [
  "backlog",
  "ready",
  "doing",
  "blocked",
] as const satisfies readonly RepoTaskState[];

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

export type InspectSecurityReviewDueOptions = {
  cooldownMs?: number;
  now?: Date;
};

type RunMetadataJson = {
  id?: string;
  workflow?: string;
  status?: string;
  completedAt?: string;
  steps?: Array<{
    id?: string;
    output?: {
      sha?: string;
    };
  }>;
};

type RunSummaryJson = {
  commitSha?: string;
};

type SecurityReviewOutcomeJson = {
  outcome?: string;
  reason?: string;
};

type SecurityReviewChangedPathClassification = {
  path: string;
  surfaces: SecurityReviewSurface[];
};

function gitLines(projectDir: string, args: readonly string[]): string[] {
  const output = execFileSync("git", args, {
    cwd: projectDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function tryGitLines(projectDir: string, args: readonly string[]): string[] | null {
  try {
    return gitLines(projectDir, args);
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

function currentGitHead(projectDir: string): SecurityReviewGitHead {
  const lines = tryGitLines(projectDir, ["rev-parse", "HEAD"]);
  const sha = lines?.[0];
  if (!sha) {
    return { kind: "unavailable", reason: "git-head-unavailable" };
  }
  return { kind: "commit", sha };
}

function commitExists(projectDir: string, sha: string): boolean {
  return tryGitLines(projectDir, ["cat-file", "-e", `${sha}^{commit}`]) !== null;
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

function extractCommitHead(
  projectDir: string,
  runDirPath: string,
  metadata: RunMetadataJson,
): SecurityReviewGitHead {
  const summary = readJsonFile<RunSummaryJson>(join(runDirPath, "run-summary.json"));
  if (summary?.commitSha && commitExists(projectDir, summary.commitSha)) {
    return { kind: "commit", sha: summary.commitSha };
  }

  const commitStepSha = metadata.steps?.find((step) => step.id === "commit")?.output?.sha;
  if (commitStepSha && commitExists(projectDir, commitStepSha)) {
    return { kind: "commit", sha: commitStepSha };
  }

  return { kind: "unavailable", reason: "review-commit-unavailable" };
}

function outcomeLabel(outcome: SecurityReviewOutcomeJson | null): string {
  if (!outcome) return "unknown";
  if (outcome.reason) return outcome.reason;
  return outcome.outcome ?? "unknown";
}

function findLastSecurityReviewEvidence(projectDir: string): SecurityReviewLastEvidence {
  const runsDir = join(projectDir, ".kota", "runs");
  if (!existsSync(runsDir)) return { kind: "none" };

  const candidates: Array<{
    runId: string;
    runDirPath: string;
    metadata: RunMetadataJson;
    outcome: SecurityReviewOutcomeJson | null;
    completedAt: SecurityReviewTimestamp;
    sortMs: number;
  }> = [];

  for (const runId of readdirSync(runsDir).sort()) {
    const runDirPath = join(runsDir, runId);
    let isDirectory = false;
    try {
      isDirectory = statSync(runDirPath).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isDirectory) continue;
    const outcomePath = join(runDirPath, "security-review-outcome.json");
    const candidatesPath = join(runDirPath, "security-review-candidates.json");
    if (!existsSync(outcomePath) && !existsSync(candidatesPath)) continue;

    const metadata = readJsonFile<RunMetadataJson>(join(runDirPath, "metadata.json")) ?? {};
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
    head: extractCommitHead(projectDir, last.runDirPath, last.metadata),
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

function changedPathsForComparison(
  projectDir: string,
  comparison: SecurityReviewComparison,
): string[] {
  if (comparison.kind === "unavailable") return [];
  const paths = (() => {
    if (comparison.kind === "commit-range") {
      return tryGitLines(projectDir, [
        "diff",
        "--name-only",
        `${comparison.baseSha}..${comparison.headSha}`,
        "--",
      ]);
    }
    if (comparison.kind === "since-time") {
      return tryGitLines(projectDir, [
        "log",
        "--format=",
        "--name-only",
        `--since=${comparison.since}`,
        "--",
      ]);
    }
    return tryGitLines(projectDir, ["ls-files"]);
  })();

  return Array.from(new Set(paths ?? [])).sort();
}

function classifyChangedPaths(
  projectDir: string,
  paths: readonly string[],
): SecurityReviewChangedPathClassification[] {
  return paths.map((path) => ({
    path,
    surfaces: securityReviewSurfacesForChangedPath(projectDir, path),
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

function listOpenSecurityReviewTasks(projectDir: string): SecurityReviewOpenTask[] {
  const tasks: SecurityReviewOpenTask[] = [];
  for (const state of OPEN_SECURITY_TASK_STATES) {
    const dir = getRepoTaskStateDir(projectDir, state);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".md") || name === "AGENTS.md") continue;
      const path = join(dir, name);
      const raw = readFileSync(path, "utf-8");
      const parsed = parseFlatFrontMatter(raw);
      const id = String(parsed.attrs.id ?? name.replace(/\.md$/, ""));
      if (!taskLooksLikeSecurityReviewFollowUp(id, parsed.body)) continue;
      tasks.push({
        id,
        title: String(parsed.attrs.title ?? id),
        state,
        path: relative(projectDir, path),
      });
    }
  }
  return tasks;
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
  projectDir: string,
  options: InspectSecurityReviewDueOptions = {},
): SecurityReviewDueDecision {
  const cooldownMs = options.cooldownMs ?? SECURITY_REVIEW_ROUTINE_COOLDOWN_MS;
  const nowMs = (options.now ?? new Date()).getTime();
  const currentHead = currentGitHead(projectDir);
  const lastReview = findLastSecurityReviewEvidence(projectDir);
  const comparison = buildComparison(currentHead, lastReview);
  const changedPaths = changedPathsForComparison(projectDir, comparison);
  const changedPathClassifications = classifyChangedPaths(projectDir, changedPaths);
  const changedSurfaces = changedSurfacesForPaths(changedPathClassifications);
  const highRiskChangedPaths = changedPathClassifications
    .filter(isHighRiskChangedPath)
    .map((classification) => classification.path);
  const openSecurityTasks = listOpenSecurityReviewTasks(projectDir);
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
