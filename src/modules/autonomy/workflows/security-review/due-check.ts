import { extname, relative } from "node:path";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import {
  getRepoTaskPath,
  listFullRepoTasks,
  type RepoTaskFullRecord,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { decodeSecurityReviewState, type SecurityReviewState, securityReviewPathUnavailable } from "./review-state.js";
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
  | { kind: "full-tree"; reason: "no-review-evidence" }
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
  contentDigests: Record<string, string>;
  previousSurfaces: Record<string, SecurityReviewSurface[]>;
  pendingEvidence: boolean;
};

function lastReviewEvidence(state: SecurityReviewState): SecurityReviewLastEvidence {
  return state.lastReview ? {
    kind: "found", runId: state.lastReview.runId,
    runDir: `.kota/runs/${state.lastReview.runId}`, workflow: "security-review",
    outcome: "explicit-path-coverage",
    head: { kind: "commit", sha: state.lastReview.head },
    completedAt: { kind: "timestamp", value: state.lastReview.completedAt, epochMs: Date.parse(state.lastReview.completedAt) },
  } : { kind: "none" };
}

export async function collectSecurityReviewGitEvidence(args: {
  workspaceRoot: string;
  scopeRoot: string;
  stateDir: string;
  runCommand: WorkflowCommandRunner;
  reviewState?: SecurityReviewState;
  evidencePaths?: readonly string[];
  evidenceRequestId?: string;
}): Promise<SecurityReviewGitEvidence> {
  const state = args.reviewState ?? decodeSecurityReviewState(null);
  const lastReview = lastReviewEvidence(state);
  try {
    const head = (await args.runCommand({ command: "git", args: ["rev-parse", "HEAD"], cwd: args.workspaceRoot })).stdout.text.trim();
    if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error("Security review Git head is malformed");
    const tree = await args.runCommand({ command: "git", args: ["ls-tree", "-r", "-z", head], cwd: args.workspaceRoot, captureLimitBytesPerStream: 10_000_000 });
    if (tree.stdout.truncated) throw new Error("Security Git evidence was truncated");
    const contentDigests: Record<string, string> = {};
    for (const entry of tree.stdout.text.split("\0").filter(Boolean)) {
      const match = /^(100644|100755|120000) blob ([a-f0-9]+)\t(.+)$/s.exec(entry);
      if (match) contentDigests[match[3]!] = match[2]!;
    }
    const retainedPaths = new Set([
      ...Object.keys(state.reviewed),
      ...Object.keys(state.unreviewedSurfaces),
      ...Object.keys(state.unavailable),
      ...Object.values(state.unavailable).flatMap((entry) => Object.keys(entry.prerequisites)),
      ...args.evidencePaths ?? [],
      ...state.evidenceRequests.flatMap(({ request }) => request.paths),
    ]);
    for (const path of retainedPaths) {
      if (!(path in contentDigests)) contentDigests[path] = "deleted";
    }
    const requestedPaths = new Map<string, string[]>();
    const addUnreviewedRequestPaths = (id: string, paths: readonly string[], reviewed: Record<string, string>) => {
      if (state.reviewedEvidenceIds.includes(id)) return;
      for (const path of paths) {
        if (reviewed[path] !== contentDigests[path]) requestedPaths.set(path, [...requestedPaths.get(path) ?? [], id]);
      }
    };
    for (const { request, reviewed } of state.evidenceRequests) {
      addUnreviewedRequestPaths(request.id, request.paths, reviewed);
    }
    addUnreviewedRequestPaths(args.evidenceRequestId ?? "explicit", args.evidencePaths ?? [],
      state.evidenceRequests.find(({ request }) => request.id === args.evidenceRequestId)?.reviewed ?? {});
    const changedPaths = Object.keys(contentDigests).filter((path) => (contentDigests[path] !== state.reviewed[path]?.digest || state.unavailable[path] !== undefined) &&
      (!securityReviewPathUnavailable(state, path, contentDigests, null) ||
        requestedPaths.get(path)?.some((id) => !securityReviewPathUnavailable(state, path, contentDigests, id)))).sort();
    const previousSurfaces: Record<string, SecurityReviewSurface[]> = {};
    for (const path of changedPaths) {
      const surfaces = securityReviewSurfacesForChangedPath(args.workspaceRoot, path, [
        ...state.reviewed[path]?.surfaces ?? [],
        ...state.unreviewedSurfaces[path] ?? [],
      ]);
      if (surfaces.length) previousSurfaces[path] = surfaces;
    }
    return {
      currentHead: { kind: "commit", sha: head }, lastReview,
      comparison: lastReview.kind === "found" && lastReview.head.kind === "commit"
        ? { kind: "commit-range", baseSha: lastReview.head.sha, headSha: head }
        : { kind: "full-tree", reason: "no-review-evidence" },
      changedPaths, contentDigests, previousSurfaces, pendingEvidence: state.evidenceRequests.some(({ request, reviewed }) => request.paths.some((path) => reviewed[path] !== contentDigests[path] && !securityReviewPathUnavailable(state, path, contentDigests, request.id))),
    };
  } catch (error) {
    return {
      currentHead: { kind: "unavailable", reason: String(error) }, lastReview,
      comparison: { kind: "unavailable", reason: "git-evidence-unavailable" }, changedPaths: [], contentDigests: {}, previousSurfaces: {}, pendingEvidence: state.evidenceRequests.length > 0,
    };
  }
}

type SecurityReviewChangedPathClassification = { path: string; surfaces: SecurityReviewSurface[] };

function classifyChangedPaths(
  workspaceRoot: string,
  paths: readonly string[],
  previousSurfaces: SecurityReviewGitEvidence["previousSurfaces"],
): SecurityReviewChangedPathClassification[] {
  return paths.map((path) => ({
    path,
    surfaces: securityReviewSurfacesForChangedPath(workspaceRoot, path, previousSurfaces[path]),
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

function listOpenSecurityReviewTasks(workspaceRoot: string, tasks: readonly RepoTaskFullRecord[]): SecurityReviewOpenTask[] {
  return tasks.filter((task) => task.state === "open" || task.state === "blocked")
    .filter((task) => taskLooksLikeSecurityReviewFollowUp(task.id, task.body))
    .map((task) => ({
      id: task.id,
      title: task.title,
      state: task.state,
      path: relative(workspaceRoot, getRepoTaskPath(workspaceRoot, task.state, task.id)),
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
  pendingEvidence: boolean;
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
  if (args.pendingEvidence) return { due: true, reason: "security-sensitive-change" };
  if (args.changedSurfaces.length === 0) {
    return { due: false, reason: "no-security-sensitive-change" };
  }
  if (args.cooldown.remainingMs > 0) {
    return { due: false, reason: "cooldown-active" };
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
  tasks: readonly RepoTaskFullRecord[] = listFullRepoTasks(workspaceRoot),
): SecurityReviewDueDecision {
  return reduceSecurityReviewDue(options, git,
    classifyChangedPaths(workspaceRoot, git.changedPaths, git.previousSurfaces),
    listOpenSecurityReviewTasks(workspaceRoot, tasks));
}

function reduceSecurityReviewDue(
  options: InspectSecurityReviewDueOptions,
  git: SecurityReviewGitEvidence,
  changedPathClassifications: SecurityReviewChangedPathClassification[],
  openSecurityTasks: SecurityReviewOpenTask[],
): SecurityReviewDueDecision {
  const cooldownMs = options.cooldownMs ?? SECURITY_REVIEW_ROUTINE_COOLDOWN_MS;
  const nowMs = (options.now ?? new Date()).getTime();
  const { currentHead, lastReview, comparison, changedPaths } = git;
  const changedSurfaces = changedSurfacesForPaths(changedPathClassifications);
  const highRiskChangedPaths = changedPathClassifications
    .filter(isHighRiskChangedPath)
    .map((classification) => classification.path);
  const cooldown = computeCooldown(lastReview, nowMs, cooldownMs);
  const decision = decideDue({
    pendingEvidence: git.pendingEvidence,
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

/** Merge observed identities without restoring coverage superseded during inspection. */
export function reconcileSecurityReviewObservation(args: {
  observedState: SecurityReviewState;
  currentState: SecurityReviewState;
  git: SecurityReviewGitEvidence;
  inspection: SecurityReviewDueDecision;
  stateDir: string;
}): { nextState: SecurityReviewState; due: SecurityReviewDueDecision } {
  const { currentState, observedState, git } = args;
  const changedPaths = git.changedPaths.filter((path) =>
    currentState.reviewed[path]?.digest !== git.contentDigests[path] &&
    currentState.reviewed[path]?.digest === observedState.reviewed[path]?.digest);
  const unreviewedSurfaces = { ...currentState.unreviewedSurfaces };
  const classifications = changedPaths.map((path) => {
    const surfaces = [...new Set([
      ...currentState.unreviewedSurfaces[path] ?? [],
      ...git.previousSurfaces[path] ?? [],
      ...args.inspection.changedSurfaces.filter((entry) => entry.paths.includes(path)).map((entry) => entry.surface),
    ])].sort();
    if (surfaces.length) unreviewedSurfaces[path] = surfaces;
    return { path, surfaces };
  });
  const lastReview = lastReviewEvidence(currentState);
  const comparison: SecurityReviewComparison = git.currentHead.kind === "unavailable"
    ? { kind: "unavailable", reason: "git-evidence-unavailable" }
    : lastReview.kind === "found" && lastReview.head.kind === "commit"
      ? { kind: "commit-range", baseSha: lastReview.head.sha, headSha: git.currentHead.sha }
      : { kind: "full-tree", reason: "no-review-evidence" };
  return {
    nextState: { ...currentState, unreviewedSurfaces },
    due: reduceSecurityReviewDue({ stateDir: args.stateDir, cooldownMs: args.inspection.cooldownMs },
      { ...git, lastReview, comparison, changedPaths, pendingEvidence: currentState.evidenceRequests.length > 0 },
      classifications, args.inspection.openSecurityTasks),
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
