import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME,
  type TrajectoryDiagnostic,
  type TrajectoryDiagnosticCode,
  type TrajectoryDiagnosticsArtifact,
} from "#core/agent-harness/index.js";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  getRepoTaskStateDir,
  getRepoTasksDir,
  moveTaskById,
  REPO_TASK_STATES,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_TRAJECTORY_DIAGNOSTIC_WINDOW_MS = 7 * MS_PER_DAY;
export const DEFAULT_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS = 3;
export const DEFAULT_TRAJECTORY_DIAGNOSTIC_REPORT_LIMIT = 5;

const TASK_ID_PREFIX = "task-repair-trajectory-diagnostic-pattern-";
const EVIDENCE_FINGERPRINT_RE =
  /<!-- trajectory-diagnostic-evidence-fingerprint: ([a-f0-9]+) -->/;
const DIAGNOSTIC_ARTIFACT_SUFFIX = `.${TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME}`;
const MAX_DETAIL_LINES = 6;
const MAX_DETAIL_LENGTH = 180;

const DIAGNOSTIC_CODES = new Set<TrajectoryDiagnosticCode>([
  "unsupported_trajectory",
  "missing_streaming_frames",
  "missing_final_verification_after_edit",
  "repeated_identical_failing_command",
  "edit_after_successful_verification",
  "long_preamble_without_task_touch",
]);

export type TrajectoryDiagnosticPatternConfig = {
  nowMs?: number;
  windowMs?: number;
  thresholdRuns?: number;
};

export type TrajectoryDiagnosticPattern = {
  workflow: string;
  stepId: string;
  code: TrajectoryDiagnosticCode;
  detailFingerprint: string;
  fingerprint: string;
  evidenceFingerprint: string;
  taskId: string;
  runIds: string[];
  runCount: number;
  artifactPaths: string[];
  windowStart: string;
  windowEnd: string;
  summary: string;
  details: string[];
  reason: string;
};

type RunWithTime = {
  run: WorkflowRunMetadata;
  timeMs: number;
  timeIso: string;
};

type DiagnosticObservation = {
  workflow: string;
  stepId: string;
  code: TrajectoryDiagnosticCode;
  detailFingerprint: string;
  fingerprint: string;
  runId: string;
  timeMs: number;
  timeIso: string;
  artifactPath: string;
  summary: string;
  details: string[];
};

type ExistingTask = {
  state: RepoTaskState;
  path: string;
  content: string;
  evidenceFingerprint: string | null;
  createdAt: string | null;
};

export type TrajectoryDiagnosticEscalationProposal =
  | {
      action: "noop";
      pattern: TrajectoryDiagnosticPattern;
      reason: string;
      existingState?: RepoTaskState;
    }
  | {
      action: "create";
      pattern: TrajectoryDiagnosticPattern;
      target: "ready";
    }
  | {
      action: "refresh";
      pattern: TrajectoryDiagnosticPattern;
      target: "ready";
      previousEvidenceFingerprint: string | null;
    }
  | {
      action: "promote";
      pattern: TrajectoryDiagnosticPattern;
      fromState: "backlog";
      target: "ready";
      previousEvidenceFingerprint: string | null;
    }
  | {
      action: "recreate";
      pattern: TrajectoryDiagnosticPattern;
      previousState: "done" | "dropped";
      target: "ready";
      previousEvidenceFingerprint: string | null;
    };

export type TrajectoryDiagnosticEscalationApplied =
  | {
      kind: "noop";
      taskId: string;
      patternFingerprint: string;
      reason: string;
      existingState?: RepoTaskState;
    }
  | {
      kind: "created";
      taskId: string;
      patternFingerprint: string;
      path: string;
    }
  | {
      kind: "refreshed";
      taskId: string;
      patternFingerprint: string;
      path: string;
    }
  | {
      kind: "promoted";
      taskId: string;
      patternFingerprint: string;
      fromState: "backlog";
      path: string;
      previousPath: string;
    }
  | {
      kind: "recreated";
      taskId: string;
      patternFingerprint: string;
      previousState: "done" | "dropped";
      path: string;
    };

export type TrajectoryDiagnosticEscalationContext = {
  projectDir: string;
  nowIso: string;
};

export type TrajectoryDiagnosticAttentionEntry = {
  workflow: string;
  stepId: string;
  code: TrajectoryDiagnosticCode;
  taskId: string;
  action: TrajectoryDiagnosticEscalationApplied["kind"] | "skipped";
  runIds: string[];
};

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value: string): string {
  return stableHash(value).slice(0, 12);
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

function projectRootFromRunsDir(runsDir: string): string {
  return dirname(dirname(runsDir));
}

function repoRelativeArtifactPath(runsDir: string, artifactPath: string): string {
  return normalizePath(relative(projectRootFromRunsDir(runsDir), artifactPath));
}

function runTime(run: WorkflowRunMetadata): RunWithTime | null {
  const raw = run.completedAt ?? run.startedAt;
  const timeMs = Date.parse(raw);
  if (!Number.isFinite(timeMs)) return null;
  return { run, timeMs, timeIso: new Date(timeMs).toISOString() };
}

function sortRunsNewestFirst(runs: WorkflowRunMetadata[]): RunWithTime[] {
  return runs
    .map(runTime)
    .filter((entry): entry is RunWithTime => entry !== null)
    .sort((a, b) => b.timeMs - a.timeMs || b.run.id.localeCompare(a.run.id));
}

function normalizeConfig(
  config: TrajectoryDiagnosticPatternConfig | undefined,
): Required<TrajectoryDiagnosticPatternConfig> {
  return {
    nowMs: config?.nowMs ?? Date.now(),
    windowMs: config?.windowMs ?? DEFAULT_TRAJECTORY_DIAGNOSTIC_WINDOW_MS,
    thresholdRuns:
      config?.thresholdRuns ?? DEFAULT_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS,
  };
}

function truncateSingleLine(value: string, max = MAX_DETAIL_LENGTH): string {
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return `${single.slice(0, max - 3)}...`;
}

function boundedDiagnosticDetails(diagnostic: TrajectoryDiagnostic): string[] {
  return diagnostic.details
    .slice(0, MAX_DETAIL_LINES)
    .map((detail) => truncateSingleLine(detail));
}

function diagnosticDetailFingerprint(diagnostic: TrajectoryDiagnostic): string {
  return shortHash(
    [
      truncateSingleLine(diagnostic.summary),
      ...boundedDiagnosticDetails(diagnostic),
    ].join("\0"),
  );
}

function patternFingerprint(args: {
  workflow: string;
  stepId: string;
  code: TrajectoryDiagnosticCode;
  detailFingerprint: string;
}): string {
  return [
    "trajectory-diagnostic",
    args.workflow,
    args.stepId,
    args.code,
    args.detailFingerprint,
  ].join(":");
}

function scopeKey(workflow: string, stepId: string): string {
  return `${workflow}\0${stepId}`;
}

function observationKey(observation: DiagnosticObservation): string {
  return [
    observation.workflow,
    observation.stepId,
    observation.code,
    observation.detailFingerprint,
  ].join("\0");
}

function readTrajectoryDiagnosticsArtifact(
  artifactPath: string,
): TrajectoryDiagnosticsArtifact {
  const raw = JSON.parse(readFileSync(artifactPath, "utf-8")) as Partial<
    TrajectoryDiagnosticsArtifact
  >;
  if (
    raw.version !== 1 ||
    (raw.status !== "supported" && raw.status !== "unsupported") ||
    typeof raw.emitsAgentMessageStream !== "boolean" ||
    !raw.counts ||
    !Array.isArray(raw.diagnostics)
  ) {
    throw new Error(
      `Malformed trajectory diagnostics artifact: ${artifactPath}`,
    );
  }
  for (const diagnostic of raw.diagnostics) {
    if (
      !diagnostic ||
      !DIAGNOSTIC_CODES.has(diagnostic.code as TrajectoryDiagnosticCode) ||
      diagnostic.severity !== "warning" ||
      typeof diagnostic.summary !== "string" ||
      !Array.isArray(diagnostic.frameIndexes) ||
      !Array.isArray(diagnostic.details) ||
      !diagnostic.details.every((detail: string) => typeof detail === "string")
    ) {
      throw new Error(
        `Malformed trajectory diagnostic entry in artifact: ${artifactPath}`,
      );
    }
  }
  return raw as TrajectoryDiagnosticsArtifact;
}

function listStepTrajectoryArtifacts(runsDir: string, runId: string): string[] {
  const stepsDir = join(runsDir, runId, "steps");
  let entries: string[];
  try {
    entries = readdirSync(stepsDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(DIAGNOSTIC_ARTIFACT_SUFFIX))
    .sort()
    .map((entry) => join(stepsDir, entry));
}

function stepIdFromArtifactPath(artifactPath: string): string {
  const file = artifactPath.split("/").pop() ?? artifactPath;
  return file.slice(0, -DIAGNOSTIC_ARTIFACT_SUFFIX.length);
}

function collectDiagnosticObservations(
  runsDir: string,
  runs: RunWithTime[],
): {
  observations: DiagnosticObservation[];
  latestScopeObservationMs: Map<string, number>;
} {
  const observations: DiagnosticObservation[] = [];
  const latestScopeObservationMs = new Map<string, number>();
  for (const entry of runs) {
    if (entry.run.status !== "success" && entry.run.status !== "completed-with-warnings") {
      continue;
    }
    for (const artifactPath of listStepTrajectoryArtifacts(runsDir, entry.run.id)) {
      const stepId = stepIdFromArtifactPath(artifactPath);
      const scope = scopeKey(entry.run.workflow, stepId);
      latestScopeObservationMs.set(
        scope,
        Math.max(latestScopeObservationMs.get(scope) ?? 0, entry.timeMs),
      );
      const artifact = readTrajectoryDiagnosticsArtifact(artifactPath);
      for (const diagnostic of artifact.diagnostics) {
        const detailFingerprint = diagnosticDetailFingerprint(diagnostic);
        const fingerprint = patternFingerprint({
          workflow: entry.run.workflow,
          stepId,
          code: diagnostic.code,
          detailFingerprint,
        });
        observations.push({
          workflow: entry.run.workflow,
          stepId,
          code: diagnostic.code,
          detailFingerprint,
          fingerprint,
          runId: entry.run.id,
          timeMs: entry.timeMs,
          timeIso: entry.timeIso,
          artifactPath: repoRelativeArtifactPath(runsDir, artifactPath),
          summary: truncateSingleLine(diagnostic.summary),
          details: boundedDiagnosticDetails(diagnostic),
        });
      }
    }
  }
  return { observations, latestScopeObservationMs };
}

function buildPattern(
  observations: DiagnosticObservation[],
): TrajectoryDiagnosticPattern {
  const chronological = [...observations].sort(
    (a, b) => a.timeMs - b.timeMs || a.runId.localeCompare(b.runId),
  );
  const first = chronological[0]!;
  const runIds = [...new Set(chronological.map((entry) => entry.runId))];
  const artifactPaths = [...new Set(chronological.map((entry) => entry.artifactPath))];
  const fingerprint = first.fingerprint;
  const evidenceFingerprint = stableHash(
    [
      fingerprint,
      ...runIds,
      ...artifactPaths,
      first.summary,
      ...first.details,
    ].join("\0"),
  );
  const reason =
    `${first.workflow}/${first.stepId} emitted ${first.code} in ` +
    `${runIds.length} recent successful workflow run artifacts.`;
  return {
    workflow: first.workflow,
    stepId: first.stepId,
    code: first.code,
    detailFingerprint: first.detailFingerprint,
    fingerprint,
    evidenceFingerprint,
    taskId: `${TASK_ID_PREFIX}${shortHash(fingerprint)}`,
    runIds,
    runCount: runIds.length,
    artifactPaths,
    windowStart: chronological[0]?.timeIso ?? "",
    windowEnd: chronological[chronological.length - 1]?.timeIso ?? "",
    summary: first.summary,
    details: first.details,
    reason,
  };
}

function groupActivePatterns(
  observations: DiagnosticObservation[],
  latestScopeObservationMs: Map<string, number>,
  thresholdRuns: number,
): TrajectoryDiagnosticPattern[] {
  const grouped = new Map<string, DiagnosticObservation[]>();
  for (const observation of observations) {
    const key = observationKey(observation);
    const list = grouped.get(key) ?? [];
    list.push(observation);
    grouped.set(key, list);
  }

  const patterns: TrajectoryDiagnosticPattern[] = [];
  for (const group of grouped.values()) {
    const first = group[0]!;
    const uniqueRunIds = new Set(group.map((entry) => entry.runId));
    if (uniqueRunIds.size < thresholdRuns) continue;

    const latestPatternMs = Math.max(...group.map((entry) => entry.timeMs));
    const latestScopeMs =
      latestScopeObservationMs.get(scopeKey(first.workflow, first.stepId)) ?? 0;
    if (latestPatternMs < latestScopeMs) continue;

    patterns.push(buildPattern(group));
  }

  return patterns.sort(
    (a, b) =>
      b.runCount - a.runCount ||
      a.workflow.localeCompare(b.workflow) ||
      a.stepId.localeCompare(b.stepId) ||
      a.code.localeCompare(b.code) ||
      a.detailFingerprint.localeCompare(b.detailFingerprint),
  );
}

export function detectRecurringTrajectoryDiagnosticPatterns(
  runsDir: string,
  config?: TrajectoryDiagnosticPatternConfig,
): TrajectoryDiagnosticPattern[] {
  const normalized = normalizeConfig(config);
  const cutoffMs = normalized.nowMs - normalized.windowMs;
  const runs = sortRunsNewestFirst(loadRunsInWindow(runsDir, cutoffMs)).filter(
    (entry) => entry.timeMs >= cutoffMs && entry.timeMs <= normalized.nowMs,
  );
  const { observations, latestScopeObservationMs } =
    collectDiagnosticObservations(runsDir, runs);
  return groupActivePatterns(
    observations,
    latestScopeObservationMs,
    normalized.thresholdRuns,
  );
}

function findExistingTask(
  projectDir: string,
  taskId: string,
): ExistingTask | null {
  const tasksDir = getRepoTasksDir(projectDir);
  for (const state of REPO_TASK_STATES) {
    const candidate = join(tasksDir, state, `${taskId}.md`);
    if (!existsSync(candidate)) continue;
    const content = readFileSync(candidate, "utf-8");
    const { attrs } = parseFlatFrontMatter(content);
    const createdAt = typeof attrs.created_at === "string" ? attrs.created_at : null;
    const evidenceMatch = content.match(EVIDENCE_FINGERPRINT_RE);
    return {
      state,
      path: candidate,
      content,
      evidenceFingerprint: evidenceMatch?.[1] ?? null,
      createdAt,
    };
  }
  return null;
}

export function proposeTrajectoryDiagnosticEscalation(
  projectDir: string,
  pattern: TrajectoryDiagnosticPattern,
): TrajectoryDiagnosticEscalationProposal {
  const existing = findExistingTask(projectDir, pattern.taskId);
  if (!existing) return { action: "create", pattern, target: "ready" };

  if (existing.state === "doing" || existing.state === "blocked") {
    return {
      action: "noop",
      pattern,
      reason: `${pattern.taskId} is already in ${existing.state}/; leaving the in-flight repair alone.`,
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
      reason: `${pattern.taskId} already records this evidence in ${existing.state}/.`,
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
  existing: ExistingTask | null,
  nowIso: string,
): { createdAt: string; updatedAt: string } {
  return {
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

function buildTrajectoryDiagnosticTaskFile(
  pattern: TrajectoryDiagnosticPattern,
  state: "ready",
  timestamps: { createdAt: string; updatedAt: string },
): string {
  const attrs = {
    id: pattern.taskId,
    title: `Repair recurring ${pattern.workflow} trajectory diagnostic`,
    status: state,
    priority: "p2",
    area: "autonomy",
    summary:
      `Fix the recurring ${pattern.code} trajectory warning in ` +
      `${pattern.workflow}/${pattern.stepId}.`,
    created_at: timestamps.createdAt,
    updated_at: timestamps.updatedAt,
  };
  return serializeFlatFrontMatter(attrs, buildTrajectoryDiagnosticTaskBody(pattern));
}

function buildTrajectoryDiagnosticTaskBody(
  pattern: TrajectoryDiagnosticPattern,
): string {
  const artifactLines = pattern.artifactPaths.map((path) => `- ${path}`);
  const detailLines = pattern.details.map((detail) => `- ${detail}`);
  return [
    "",
    "## Problem",
    "",
    "Recent successful workflow runs are repeatedly emitting the same",
    "trajectory-diagnostic warning. A single advisory warning can be local",
    "noise; this pattern crossed the configured recurrence threshold and should",
    "be repaired as normal task work.",
    "",
    `Pattern fingerprint: \`${pattern.fingerprint}\``,
    `Evidence fingerprint: \`${pattern.evidenceFingerprint}\``,
    "",
    "## Diagnostic Evidence",
    "",
    `- Warning codes: ${pattern.code}`,
    `- Affected workflow/step: ${pattern.workflow}/${pattern.stepId}`,
    `- Detail fingerprint: ${pattern.detailFingerprint}`,
    `- Run ids: ${pattern.runIds.join(", ")}`,
    `- Window: ${pattern.windowStart} to ${pattern.windowEnd}`,
    `- Active reason: ${pattern.reason}`,
    `- Summary: ${pattern.summary}`,
    "",
    "Evidence artifacts:",
    "",
    ...artifactLines,
    "",
    "Bounded diagnostic details:",
    "",
    ...(detailLines.length > 0 ? detailLines : ["- (none)"]),
    "",
    "## Desired Outcome",
    "",
    "Repair the workflow, prompt, validation, harness, or verification behavior",
    "so fresh successful run artifacts no longer emit this pattern fingerprint.",
    "Keep the typed diagnostic signal intact unless the detector itself is",
    "miscalibrated and the adjustment is covered by focused tests.",
    "",
    "## Constraints",
    "",
    "- Use existing trajectory-diagnostics artifacts as evidence.",
    "- Do not scrape raw event streams, prompts, secrets, or full tool outputs.",
    "- Do not create one task per run; keep this task anchored to the stable",
    "  pattern fingerprint above.",
    "- Keep operator-only cost and report ranking out of autonomy-agent prompts.",
    "",
    "## Done When",
    "",
    "- Fresh run artifacts no longer trigger this trajectory-diagnostic pattern,",
    "  or the threshold/fingerprint behavior is deliberately adjusted with tests.",
    "- Focused tests cover the local cause and the detector behavior that would",
    "  have caught this recurrence.",
    "- Operator-facing report or attention output still names future active",
    "  trajectory-diagnostic patterns and repair task ids.",
    "",
    "## Source / Intent",
    "",
    "Auto-created by `trajectory-diagnostic-escalator` from recent workflow",
    "agent-step trajectory-diagnostics artifacts. Repeated successful-run",
    "process-quality warnings should become reviewable repair work instead of",
    "remaining manual artifact archaeology.",
    "",
    "## Initiative",
    "",
    "Outcome-grade autonomy evaluation: successful workflow runs should remain",
    "inspectable and repairable when process-quality evidence shows repeated",
    "weak success patterns.",
    "",
    "## Acceptance Evidence",
    "",
    "- Test output for the repaired workflow, prompt, harness, or validation path.",
    "- Detector test or run artifact showing this pattern no longer crosses the",
    "  escalation gate on fresh evidence.",
    "- Operator-facing report or attention fixture showing future escalations",
    "  include the repair task id without cost fields.",
    "",
    `<!-- trajectory-diagnostic-pattern-fingerprint: ${pattern.fingerprint} -->`,
    `<!-- trajectory-diagnostic-evidence-fingerprint: ${pattern.evidenceFingerprint} -->`,
    "",
  ].join("\n");
}

function stagePath(projectDir: string, path: string): void {
  execFileSync("git", ["add", path], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
  });
}

export function applyTrajectoryDiagnosticEscalation(
  proposal: TrajectoryDiagnosticEscalationProposal,
  ctx: TrajectoryDiagnosticEscalationContext,
): TrajectoryDiagnosticEscalationApplied {
  const { pattern } = proposal;
  if (proposal.action === "noop") {
    return {
      kind: "noop",
      taskId: pattern.taskId,
      patternFingerprint: pattern.fingerprint,
      reason: proposal.reason,
      ...(proposal.existingState ? { existingState: proposal.existingState } : {}),
    };
  }

  const existing = findExistingTask(ctx.projectDir, pattern.taskId);
  const targetDir = getRepoTaskStateDir(ctx.projectDir, "ready");
  const targetPath = join(targetDir, `${pattern.taskId}.md`);
  mkdirSync(targetDir, { recursive: true });

  if (proposal.action === "create") {
    if (existsSync(targetPath)) {
      throw new Error(
        `trajectory-diagnostic-escalation: refusing to overwrite existing ${targetPath}`,
      );
    }
    writeFileSync(
      targetPath,
      buildTrajectoryDiagnosticTaskFile(
        pattern,
        "ready",
        taskTimestamps(null, ctx.nowIso),
      ),
      "utf-8",
    );
    stagePath(ctx.projectDir, targetPath);
    return {
      kind: "created",
      taskId: pattern.taskId,
      patternFingerprint: pattern.fingerprint,
      path: targetPath.slice(ctx.projectDir.length + 1),
    };
  }

  if (proposal.action === "refresh") {
    if (!existing || existing.state !== "ready") {
      throw new Error(
        `trajectory-diagnostic-escalation: expected ${pattern.taskId} in ready/ for refresh`,
      );
    }
    writeFileSync(
      targetPath,
      buildTrajectoryDiagnosticTaskFile(
        pattern,
        "ready",
        taskTimestamps(existing, ctx.nowIso),
      ),
      "utf-8",
    );
    stagePath(ctx.projectDir, targetPath);
    return {
      kind: "refreshed",
      taskId: pattern.taskId,
      patternFingerprint: pattern.fingerprint,
      path: targetPath.slice(ctx.projectDir.length + 1),
    };
  }

  if (proposal.action === "promote") {
    const move = moveTaskById(ctx.projectDir, pattern.taskId, "ready");
    const promoted = findExistingTask(ctx.projectDir, pattern.taskId);
    writeFileSync(
      targetPath,
      buildTrajectoryDiagnosticTaskFile(
        pattern,
        "ready",
        taskTimestamps(promoted, ctx.nowIso),
      ),
      "utf-8",
    );
    stagePath(ctx.projectDir, targetPath);
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
      `trajectory-diagnostic-escalation: expected ${pattern.taskId} in ${proposal.previousState}/ for recreate`,
    );
  }
  if (existsSync(targetPath)) {
    throw new Error(
      `trajectory-diagnostic-escalation: refusing to overwrite existing ${targetPath}`,
    );
  }
  execFileSync("git", ["mv", previousPath, targetPath], {
    cwd: ctx.projectDir,
    env: withProtectedGitBareRepositoryEnv(),
  });
  writeFileSync(
    targetPath,
    buildTrajectoryDiagnosticTaskFile(
      pattern,
      "ready",
      taskTimestamps(existing, ctx.nowIso),
    ),
    "utf-8",
  );
  stagePath(ctx.projectDir, targetPath);
  return {
    kind: "recreated",
    taskId: pattern.taskId,
    patternFingerprint: pattern.fingerprint,
    previousState: proposal.previousState,
    path: targetPath.slice(ctx.projectDir.length + 1),
  };
}

export function buildTrajectoryDiagnosticAttentionDigest(
  entries: TrajectoryDiagnosticAttentionEntry[],
): { items: Array<{ label: string; detail: string }>; text: string } {
  const items = entries.map((entry) => ({
    label: "Trajectory diagnostic escalated",
    detail:
      `${entry.workflow}/${entry.stepId} ${entry.code}; task ${entry.taskId}; ` +
      `action ${entry.action}; runs ${entry.runIds.join(", ")}`,
  }));
  const header = `Attention digest (${items.length} item${items.length === 1 ? "" : "s"}):`;
  const text = [
    header,
    ...items.map((item) => `• *${item.label}*: ${item.detail}`),
  ].join("\n");
  return { items, text };
}
