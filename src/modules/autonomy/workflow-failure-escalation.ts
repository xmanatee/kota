import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { readRepairIterations } from "#core/workflow/repair-iteration-output.js";
import type { WorkflowRunMetadata, WorkflowRunWarning } from "#core/workflow/run-types.js";
import {
  getRepoTaskStateDir,
  getRepoTasksDir,
  moveTaskById,
  REPO_TASK_STATES,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";
import { hasInfrastructureAgentFailure } from "./run-outcome-aggregation.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 7 * MS_PER_DAY;
export const DEFAULT_CONSECUTIVE_FAILURE_RUNS = 3;
export const DEFAULT_FAILURE_RATE_MIN_RUNS = 3;
export const DEFAULT_FAILURE_RATE_MIN_WINDOW_MS = 2 * MS_PER_DAY;
export const DEFAULT_REPEATED_WARNING_RUNS = 3;
const TASK_ID_PREFIX = "task-repair-workflow-failure-pattern-";
const EVIDENCE_FINGERPRINT_RE =
  /<!-- workflow-failure-evidence-fingerprint: ([a-f0-9]+) -->/;

type FailureSignalKind = "repair-check" | "step-error" | "workflow-status";
type PatternSignalKind = FailureSignalKind | "repair-warning";

type FailureSignal = {
  kind: FailureSignalKind;
  id: string;
  label: string;
  evidence: string;
};

export type WorkflowFailurePatternKind =
  | "consecutive-failures"
  | "terminal-failure-rate"
  | "repeated-warning";

export type WorkflowFailurePattern = {
  kind: WorkflowFailurePatternKind;
  workflow: string;
  signalKind: PatternSignalKind;
  signalId: string;
  signalLabel: string;
  fingerprint: string;
  evidenceFingerprint: string;
  taskId: string;
  runIds: string[];
  runCount: number;
  windowStart: string;
  windowEnd: string;
  reason: string;
  evidence: string[];
};

export type WorkflowFailurePatternConfig = {
  nowMs?: number;
  windowMs?: number;
  consecutiveFailureRuns?: number;
  failureRateMinRuns?: number;
  failureRateMinWindowMs?: number;
  repeatedWarningRuns?: number;
};

type RunWithTime = {
  run: WorkflowRunMetadata;
  timeMs: number;
  timeIso: string;
};

type ExistingTask = {
  state: RepoTaskState;
  path: string;
  content: string;
  evidenceFingerprint: string | null;
  createdAt: string | null;
};

export type WorkflowFailureEscalationProposal =
  | {
      action: "noop";
      pattern: WorkflowFailurePattern;
      reason: string;
      existingState?: RepoTaskState;
    }
  | {
      action: "create";
      pattern: WorkflowFailurePattern;
      target: "ready";
    }
  | {
      action: "refresh";
      pattern: WorkflowFailurePattern;
      target: "ready";
      previousEvidenceFingerprint: string | null;
    }
  | {
      action: "promote";
      pattern: WorkflowFailurePattern;
      fromState: "backlog";
      target: "ready";
      previousEvidenceFingerprint: string | null;
    }
  | {
      action: "recreate";
      pattern: WorkflowFailurePattern;
      previousState: "done" | "dropped";
      target: "ready";
      previousEvidenceFingerprint: string | null;
    };

export type WorkflowFailureEscalationApplied =
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

export type WorkflowFailureEscalationContext = {
  projectDir: string;
  nowIso: string;
};

export type WorkflowFailureAttentionEntry = {
  workflow: string;
  taskId: string;
  action: WorkflowFailureEscalationApplied["kind"] | "skipped";
  kind: WorkflowFailurePatternKind;
  signal: string;
  runIds: string[];
};

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value: string): string {
  return stableHash(value).slice(0, 12);
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

function groupedByWorkflow(runs: RunWithTime[]): Map<string, RunWithTime[]> {
  const grouped = new Map<string, RunWithTime[]>();
  for (const entry of runs) {
    const list = grouped.get(entry.run.workflow) ?? [];
    list.push(entry);
    grouped.set(entry.run.workflow, list);
  }
  return grouped;
}

function truncateSingleLine(value: string, max = 180): string {
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return `${single.slice(0, max - 3)}...`;
}

function normalizeError(error: string): string {
  return truncateSingleLine(
    error
      .replace(/[0-9a-f]{7,40}/gi, "<hash>")
      .replace(/\d+/g, "<n>"),
    240,
  );
}

function signalKey(signal: Pick<FailureSignal, "kind" | "id">): string {
  return `${signal.kind}\0${signal.id}`;
}

function collectTerminalFailureSignals(run: WorkflowRunMetadata): FailureSignal[] {
  if (run.status !== "failed") return [];
  if (hasInfrastructureAgentFailure(run)) return [];

  const signals = new Map<string, FailureSignal>();
  const add = (signal: FailureSignal) => {
    signals.set(signalKey(signal), signal);
  };

  for (const step of run.steps) {
    const iterations = readRepairIterations(step.output);
    const lastIteration = iterations[iterations.length - 1];
    if (step.status === "failed" && lastIteration) {
      for (const failure of lastIteration.failures) {
        add({
          kind: "repair-check",
          id: failure.id,
          label: `repair-check ${failure.id}`,
          evidence: `run ${run.id} ended with repair-check ${failure.id}`,
        });
      }
    }
  }

  if (signals.size > 0) return [...signals.values()];

  const failedStep = run.steps.find((step) => step.status === "failed");
  if (failedStep?.error) {
    const normalized = normalizeError(failedStep.error);
    const id = `${failedStep.id}:${shortHash(normalized)}`;
    add({
      kind: "step-error",
      id,
      label: `step ${failedStep.id} error ${id.split(":")[1]}`,
      evidence: `run ${run.id} failed at step ${failedStep.id}: ${normalized}`,
    });
    return [...signals.values()];
  }

  if (failedStep) {
    add({
      kind: "step-error",
      id: `${failedStep.id}:no-error`,
      label: `step ${failedStep.id} failed without error text`,
      evidence: `run ${run.id} failed at step ${failedStep.id} without error text`,
    });
    return [...signals.values()];
  }

  add({
    kind: "workflow-status",
    id: "failed-without-failed-step",
    label: "workflow failed without a failed step",
    evidence: `run ${run.id} had terminal status failed without a failed step`,
  });
  return [...signals.values()];
}

function collectWarningSignals(
  run: WorkflowRunMetadata,
): Array<{ id: string; warning: WorkflowRunWarning }> {
  if (run.status !== "completed-with-warnings") return [];
  const seen = new Set<string>();
  const out: Array<{ id: string; warning: WorkflowRunWarning }> = [];
  for (const warning of run.warnings ?? []) {
    const id = warning.type.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, warning });
  }
  return out;
}

function patternFingerprint(
  kind: WorkflowFailurePatternKind,
  workflow: string,
  signalKind: PatternSignalKind,
  signalId: string,
): string {
  return `workflow-failure:${kind}:${workflow}:${signalKind}:${shortHash(signalId)}`;
}

function buildPattern(opts: {
  kind: WorkflowFailurePatternKind;
  workflow: string;
  signalKind: PatternSignalKind;
  signalId: string;
  signalLabel: string;
  runs: RunWithTime[];
  reason: string;
  evidence: string[];
}): WorkflowFailurePattern {
  const chronological = [...opts.runs].sort(
    (a, b) => a.timeMs - b.timeMs || a.run.id.localeCompare(b.run.id),
  );
  const runIds = chronological.map((entry) => entry.run.id);
  const windowStart = chronological[0]?.timeIso ?? "";
  const windowEnd = chronological[chronological.length - 1]?.timeIso ?? "";
  const fingerprint = patternFingerprint(
    opts.kind,
    opts.workflow,
    opts.signalKind,
    opts.signalId,
  );
  const evidenceFingerprint = stableHash(
    [
      fingerprint,
      ...runIds,
      opts.reason,
      ...opts.evidence,
    ].join("\0"),
  );
  return {
    kind: opts.kind,
    workflow: opts.workflow,
    signalKind: opts.signalKind,
    signalId: opts.signalId,
    signalLabel: opts.signalLabel,
    fingerprint,
    evidenceFingerprint,
    taskId: `${TASK_ID_PREFIX}${shortHash(fingerprint)}`,
    runIds,
    runCount: runIds.length,
    windowStart,
    windowEnd,
    reason: opts.reason,
    evidence: opts.evidence,
  };
}

function detectConsecutiveFailurePatterns(
  workflow: string,
  runs: RunWithTime[],
  threshold: number,
): WorkflowFailurePattern[] {
  const streak: Array<{ entry: RunWithTime; signals: FailureSignal[] }> = [];
  for (const entry of runs) {
    if (entry.run.status === "running" || entry.run.status === "interrupted") {
      continue;
    }
    if (entry.run.status !== "failed") break;
    const signals = collectTerminalFailureSignals(entry.run);
    if (signals.length === 0) break;
    streak.push({ entry, signals });
  }
  if (streak.length < threshold) return [];

  const firstSignals = streak[0].signals;
  const patterns: WorkflowFailurePattern[] = [];
  for (const signal of firstSignals) {
    const key = signalKey(signal);
    const matching = [];
    const evidence: string[] = [];
    for (const item of streak) {
      const found = item.signals.find((candidate) => signalKey(candidate) === key);
      if (!found) break;
      matching.push(item.entry);
      evidence.push(found.evidence);
    }
    if (matching.length < threshold) continue;
    patterns.push(
      buildPattern({
        kind: "consecutive-failures",
        workflow,
        signalKind: signal.kind,
        signalId: signal.id,
        signalLabel: signal.label,
        runs: matching,
        reason:
          `${workflow} has ${matching.length} consecutive failed completed runs ` +
          `with the same owned failure class (${signal.label}).`,
        evidence,
      }),
    );
  }
  return patterns;
}

function detectFailureRatePattern(
  workflow: string,
  runs: RunWithTime[],
  minRuns: number,
  minWindowMs: number,
): WorkflowFailurePattern | null {
  const terminal = runs.filter(
    (entry) => entry.run.status !== "running" && entry.run.status !== "interrupted",
  );
  if (terminal.length < minRuns) return null;
  if (terminal.some((entry) => entry.run.status !== "failed")) return null;

  const oldest = terminal[terminal.length - 1];
  const newest = terminal[0];
  if (!oldest || !newest) return null;
  if (newest.timeMs - oldest.timeMs < minWindowMs) return null;

  const evidence: string[] = [];
  for (const entry of terminal) {
    const signals = collectTerminalFailureSignals(entry.run);
    if (signals.length === 0) return null;
    evidence.push(
      `run ${entry.run.id} failed with ${signals.map((signal) => signal.label).join(", ")}`,
    );
  }

  return buildPattern({
    kind: "terminal-failure-rate",
    workflow,
    signalKind: "workflow-status",
    signalId: "terminal-failure-rate-100",
    signalLabel: "100% terminal failure rate",
    runs: terminal,
    reason:
      `${workflow} is at a 100% terminal failure rate across ` +
      `${terminal.length} non-infrastructure runs in the configured window.`,
    evidence,
  });
}

function detectRepeatedWarningPatterns(
  workflow: string,
  runs: RunWithTime[],
  threshold: number,
): WorkflowFailurePattern[] {
  if (runs.some((entry) => entry.run.status === "failed")) return [];

  const byWarning = new Map<
    string,
    { warning: WorkflowRunWarning; entries: RunWithTime[] }
  >();
  for (const entry of runs) {
    for (const signal of collectWarningSignals(entry.run)) {
      const current = byWarning.get(signal.id) ?? {
        warning: signal.warning,
        entries: [],
      };
      current.entries.push(entry);
      byWarning.set(signal.id, current);
    }
  }

  const patterns: WorkflowFailurePattern[] = [];
  for (const [warningId, value] of byWarning) {
    if (value.entries.length < threshold) continue;
    const message = truncateSingleLine(value.warning.message);
    patterns.push(
      buildPattern({
        kind: "repeated-warning",
        workflow,
        signalKind: "repair-warning",
        signalId: warningId,
        signalLabel: `warning ${warningId}`,
        runs: value.entries,
        reason:
          `${workflow} completed with warning ${warningId} in ` +
          `${value.entries.length} recent runs while no terminal failures are present.`,
        evidence: value.entries.map(
          (entry) => `run ${entry.run.id} completed with warning ${warningId}: ${message}`,
        ),
      }),
    );
  }
  return patterns;
}

function normalizeConfig(
  config: WorkflowFailurePatternConfig | undefined,
): Required<WorkflowFailurePatternConfig> {
  return {
    nowMs: config?.nowMs ?? Date.now(),
    windowMs: config?.windowMs ?? DEFAULT_WINDOW_MS,
    consecutiveFailureRuns:
      config?.consecutiveFailureRuns ?? DEFAULT_CONSECUTIVE_FAILURE_RUNS,
    failureRateMinRuns:
      config?.failureRateMinRuns ?? DEFAULT_FAILURE_RATE_MIN_RUNS,
    failureRateMinWindowMs:
      config?.failureRateMinWindowMs ?? DEFAULT_FAILURE_RATE_MIN_WINDOW_MS,
    repeatedWarningRuns:
      config?.repeatedWarningRuns ?? DEFAULT_REPEATED_WARNING_RUNS,
  };
}

export function detectPersistentWorkflowFailurePatternsFromRuns(
  runs: WorkflowRunMetadata[],
  config?: WorkflowFailurePatternConfig,
): WorkflowFailurePattern[] {
  const normalized = normalizeConfig(config);
  const cutoffMs = normalized.nowMs - normalized.windowMs;
  const recentRuns = sortRunsNewestFirst(runs).filter(
    (entry) => entry.timeMs >= cutoffMs,
  );
  const patterns: WorkflowFailurePattern[] = [];
  const workflowsWithSpecificFailurePattern = new Set<string>();

  for (const [workflow, workflowRuns] of groupedByWorkflow(recentRuns)) {
    const consecutive = detectConsecutiveFailurePatterns(
      workflow,
      workflowRuns,
      normalized.consecutiveFailureRuns,
    );
    if (consecutive.length > 0) {
      workflowsWithSpecificFailurePattern.add(workflow);
      patterns.push(...consecutive);
    }
  }

  for (const [workflow, workflowRuns] of groupedByWorkflow(recentRuns)) {
    if (!workflowsWithSpecificFailurePattern.has(workflow)) {
      const rate = detectFailureRatePattern(
        workflow,
        workflowRuns,
        normalized.failureRateMinRuns,
        normalized.failureRateMinWindowMs,
      );
      if (rate) patterns.push(rate);
    }
    patterns.push(
      ...detectRepeatedWarningPatterns(
        workflow,
        workflowRuns,
        normalized.repeatedWarningRuns,
      ),
    );
  }

  return patterns.sort(
    (a, b) =>
      a.workflow.localeCompare(b.workflow) ||
      a.kind.localeCompare(b.kind) ||
      a.signalId.localeCompare(b.signalId),
  );
}

export function detectPersistentWorkflowFailurePatterns(
  runsDir: string,
  config?: WorkflowFailurePatternConfig,
): WorkflowFailurePattern[] {
  const normalized = normalizeConfig(config);
  const runs = loadRunsInWindow(runsDir, normalized.nowMs - normalized.windowMs);
  return detectPersistentWorkflowFailurePatternsFromRuns(runs, normalized);
}

function findExistingTask(projectDir: string, taskId: string): ExistingTask | null {
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

export function proposeWorkflowFailureEscalation(
  projectDir: string,
  pattern: WorkflowFailurePattern,
): WorkflowFailureEscalationProposal {
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

function buildWorkflowFailureTaskFile(
  pattern: WorkflowFailurePattern,
  state: "ready",
  timestamps: { createdAt: string; updatedAt: string },
): string {
  const attrs: Record<string, string> = {
    id: pattern.taskId,
    title: `Repair persistent ${pattern.workflow} workflow failure pattern`,
    status: state,
    priority: "p1",
    area: "autonomy",
    summary:
      `Fix the local cause behind ${pattern.workflow}'s persistent ` +
      `${describePatternKind(pattern.kind)} signal (${pattern.signalLabel}).`,
    created_at: timestamps.createdAt,
    updated_at: timestamps.updatedAt,
  };
  return serializeFlatFrontMatter(attrs, buildWorkflowFailureTaskBody(pattern));
}

function describePatternKind(kind: WorkflowFailurePatternKind): string {
  switch (kind) {
    case "consecutive-failures":
      return "consecutive failure";
    case "terminal-failure-rate":
      return "100% terminal failure-rate";
    case "repeated-warning":
      return "repeated warning";
  }
}

function buildWorkflowFailureTaskBody(pattern: WorkflowFailurePattern): string {
  const evidenceLines = pattern.evidence.map((line) => `- ${line}`);
  const lines = [
    "",
    "## Problem",
    "",
    `The \`${pattern.workflow}\` workflow crossed the persistent failure-pattern gate.`,
    "The detector excluded classified infrastructure/provider/auth/rate-limit",
    "and agent-step timeout failures before creating this task, so the remaining",
    "signal is considered local and code-actionable.",
    "",
    `Pattern fingerprint: \`${pattern.fingerprint}\``,
    `Evidence fingerprint: \`${pattern.evidenceFingerprint}\``,
    "",
    "## Failure Evidence",
    "",
    `- Pattern: ${describePatternKind(pattern.kind)}`,
    `- Workflow: ${pattern.workflow}`,
    `- Failure class: ${pattern.signalKind}:${pattern.signalId}`,
    `- Signal: ${pattern.signalLabel}`,
    `- Run ids: ${pattern.runIds.join(", ")}`,
    `- Window: ${pattern.windowStart} to ${pattern.windowEnd}`,
    `- Actionable reason: ${pattern.reason}`,
    "",
    ...evidenceLines,
    "",
    "## Desired Outcome",
    "",
    "Repair the local workflow/runtime cause so the same pattern no longer",
    "fires on fresh run artifacts. The fix may live in workflow code, repair",
    "checks, validation, queue shaping, prompts, or local runtime handling, but",
    "it should not hide the signal by broadening infrastructure exclusions",
    "without evidence that the failure is actually outside KOTA's control.",
    "",
    "## Constraints",
    "",
    "- Use existing `.kota/runs/` metadata and run artifacts as evidence.",
    "- Keep cost and throughput data out of autonomy-agent context.",
    "- Do not create one task per run; keep this task anchored to the stable",
    "  pattern fingerprint above.",
    "- Preserve provider/auth/rate-limit/timeout exclusions unless the local",
    "  runtime handling is the defect being repaired.",
    "",
    "## Done When",
    "",
    "- Fresh run artifacts no longer trigger this pattern fingerprint, or the",
    "  threshold/classification is deliberately adjusted with a committed reason.",
    "- Focused tests cover the local cause and the detector behavior that would",
    "  have caught this recurrence.",
    "- Operator-facing attention output still reports future escalations with",
    "  the generated task id and without cost fields.",
    "",
    "## Source / Intent",
    "",
    "Auto-created by `workflow-failure-escalator` from recent workflow run",
    "metadata. Persistent non-infrastructure workflow failures should become",
    "one evidence-backed repair task instead of remaining only in digests or",
    "improver context.",
    "",
    "## Initiative",
    "",
    "Autonomy fleet health: recurring local workflow failures should graduate",
    "into deterministic, reviewable repair work.",
    "",
    "## Acceptance Evidence",
    "",
    "- Test output for the repaired workflow or runtime path.",
    "- Detector test or run artifact showing this pattern no longer crosses the",
    "  escalation gate on fresh evidence.",
    "- Attention-event fixture or transcript showing any future escalation names",
    "  the task id without cost fields.",
    "",
    `<!-- workflow-failure-pattern-fingerprint: ${pattern.fingerprint} -->`,
    `<!-- workflow-failure-evidence-fingerprint: ${pattern.evidenceFingerprint} -->`,
    "",
  ];
  return lines.join("\n");
}

function stagePath(projectDir: string, path: string): void {
  execFileSync("git", ["add", path], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
  });
}

export function applyWorkflowFailureEscalation(
  proposal: WorkflowFailureEscalationProposal,
  ctx: WorkflowFailureEscalationContext,
): WorkflowFailureEscalationApplied {
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
        `workflow-failure-escalation: refusing to overwrite existing ${targetPath}`,
      );
    }
    writeFileSync(
      targetPath,
      buildWorkflowFailureTaskFile(
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
        `workflow-failure-escalation: expected ${pattern.taskId} in ready/ for refresh`,
      );
    }
    writeFileSync(
      targetPath,
      buildWorkflowFailureTaskFile(
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
      buildWorkflowFailureTaskFile(
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
      `workflow-failure-escalation: expected ${pattern.taskId} in ${proposal.previousState}/ for recreate`,
    );
  }
  if (existsSync(targetPath)) {
    throw new Error(
      `workflow-failure-escalation: refusing to overwrite existing ${targetPath}`,
    );
  }
  execFileSync("git", ["mv", previousPath, targetPath], {
    cwd: ctx.projectDir,
    env: withProtectedGitBareRepositoryEnv(),
  });
  writeFileSync(
    targetPath,
    buildWorkflowFailureTaskFile(
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

export function buildWorkflowFailureAttentionDigest(
  entries: WorkflowFailureAttentionEntry[],
): { items: Array<{ label: string; detail: string }>; text: string } {
  const items = entries.map((entry) => ({
    label: "Workflow failure escalated",
    detail:
      `${entry.workflow} ${describePatternKind(entry.kind)} (${entry.signal}); ` +
      `task ${entry.taskId}; action ${entry.action}; runs ${entry.runIds.join(", ")}`,
  }));
  const header = `Attention digest (${items.length} item${items.length === 1 ? "" : "s"}):`;
  const text = [
    header,
    ...items.map((item) => `• *${item.label}*: ${item.detail}`),
  ].join("\n");
  return { items, text };
}
