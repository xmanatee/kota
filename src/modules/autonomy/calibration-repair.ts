/**
 * Deterministic corrective path for the live-run evaluator calibration gate.
 *
 * When `evaluator-calibration-monitor` decides the gate is firing, this module
 * proposes the concrete next action against the repo-tasks queue and applies
 * it. The action is one of:
 *
 *   - `noop`    — an active calibration repair task already exists (ready,
 *                 doing, blocked, or backlog). Re-firing the gate while the
 *                 same repair is in flight should not churn the queue.
 *   - `create`  — no current repair task exists. Write the templated task
 *                 directly to `ready/` so a builder run picks it up.
 *   - `recreate` — a previous repair task is in `done/` or `dropped/`. The
 *                 calibration drift is recurring, so rewrite the task back
 *                 into `ready/` (the previous file is removed by the move).
 *   - `promote` — the repair task already exists in `backlog/` or `blocked/`.
 *                 Promote it to `ready/` so the next builder pulls it.
 *
 * The proposer is pure: it inspects the disk and returns a typed action.
 * The applier performs the disk mutation through the same `git mv` /
 * staged-write path the rest of the autonomy queue uses, so the monitor's
 * commit step picks up the changes.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  getRepoTaskStateDir,
  getRepoTasksDir,
  type MoveTaskResult,
  moveTaskById,
  REPO_TASK_STATES,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  type CalibrationDriftKind,
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationAggregate,
  type EvaluatorCalibrationArtifact,
} from "./evaluator-calibration.js";

export const CALIBRATION_REPAIR_TASK_ID = "task-evaluator-calibration-drift-repair";

const NOOP_STATES: ReadonlySet<RepoTaskState> = new Set([
  "ready",
  "doing",
  "blocked",
]);

const RECREATE_STATES: ReadonlySet<RepoTaskState> = new Set(["done", "dropped"]);

export type CalibrationRepairProposal =
  | {
      action: "noop";
      reason: string;
      existingState: RepoTaskState;
    }
  | {
      action: "create";
      taskId: string;
      target: "ready";
    }
  | {
      action: "recreate";
      taskId: string;
      previousState: "done" | "dropped";
      target: "ready";
    }
  | {
      action: "promote";
      taskId: string;
      fromState: "backlog" | "blocked";
      target: "ready";
    };

export type CalibrationRepairContext = {
  projectDir: string;
  decisionReason: string;
  driftKinds: readonly CalibrationDriftKind[];
  aggregate: EvaluatorCalibrationAggregate;
  thresholdRate: number;
  passWithWarningsThresholdRate: number;
  /** Stable timestamp for both task body and frontmatter `updated_at`. */
  nowIso: string;
};

function findExistingRepairTaskState(projectDir: string): RepoTaskState | null {
  const tasksDir = getRepoTasksDir(projectDir);
  for (const state of REPO_TASK_STATES) {
    const candidate = join(tasksDir, state, `${CALIBRATION_REPAIR_TASK_ID}.md`);
    if (existsSync(candidate)) return state;
  }
  return null;
}

/**
 * Most recent calibration artifact's `completedAt` across the entire runs
 * directory, in epoch ms. Returns null when no artifact has been written or
 * when none parses cleanly. Walks the directory in reverse-sorted order so the
 * first artifact found is the newest; the directory naming convention prefixes
 * timestamps so lexical sort matches chronological sort. The full set is
 * relevant rather than just the gate's window because the staleness check
 * compares against task-file commits which are not window-scoped.
 */
function lastCalibrationArtifactCompletedAtMs(projectDir: string): number | null {
  const runsDir = join(projectDir, ".kota", "runs");
  if (!existsSync(runsDir)) return null;
  const entries = readdirSync(runsDir).sort().reverse();
  for (const entry of entries) {
    const path = join(runsDir, entry, EVALUATOR_CALIBRATION_ARTIFACT);
    let parsed: EvaluatorCalibrationArtifact | null;
    try {
      parsed = readOptionalJsonFile<EvaluatorCalibrationArtifact>(path);
    } catch {
      continue;
    }
    if (!parsed) continue;
    if (typeof parsed.completedAt !== "string") continue;
    const ms = Date.parse(parsed.completedAt);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/**
 * Last commit timestamp (committer date) for a path in the repo, in epoch ms.
 * Returns null when the file has no git history yet (e.g. the test sandbox
 * staged it but has not committed it).
 */
function lastCommitMsForPath(projectDir: string, absolutePath: string): number | null {
  let raw: string;
  try {
    raw = execFileSync("git", ["log", "-1", "--format=%cI", "--", absolutePath], {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Decide what to do about the calibration repair task. Pure: reads disk to
 * find the current state, but does not mutate.
 */
export function proposeCalibrationRepair(
  ctx: CalibrationRepairContext,
): CalibrationRepairProposal {
  const existing = findExistingRepairTaskState(ctx.projectDir);
  if (existing && NOOP_STATES.has(existing)) {
    const reason = existing === "blocked"
      ? `${CALIBRATION_REPAIR_TASK_ID} is honestly blocked — let the blocked-promoter handle the precondition.`
      : `${CALIBRATION_REPAIR_TASK_ID} already in ${existing}/ — leaving the in-flight repair alone.`;
    return { action: "noop", reason, existingState: existing };
  }
  if (existing === "backlog") {
    return {
      action: "promote",
      taskId: CALIBRATION_REPAIR_TASK_ID,
      fromState: "backlog",
      target: "ready",
    };
  }
  if (existing && RECREATE_STATES.has(existing)) {
    // Defend against the recreate-loop that fires once per prompt update: a
    // builder closes the previous repair task to done/ when the fix lands; the
    // monitor that runs on `workflow.build.committed` from the same commit may
    // still hold the pre-fix module imports because the daemon restart has not
    // completed yet. Under those stale imports the gate aggregation skips the
    // post-ea9bda71 hash filter and re-fires on pre-fix verdicts. When the
    // done-task's most recent commit is later than the most recent calibration
    // artifact on disk, no post-fix builder run has written calibration data
    // yet, so the gate is firing on data that pre-dates the fix. Return noop
    // and wait for fresh evidence.
    const previousTaskPath = join(
      getRepoTaskStateDir(ctx.projectDir, existing),
      `${CALIBRATION_REPAIR_TASK_ID}.md`,
    );
    const closedAtMs = lastCommitMsForPath(ctx.projectDir, previousTaskPath);
    const lastArtifactMs = lastCalibrationArtifactCompletedAtMs(ctx.projectDir);
    if (closedAtMs !== null && lastArtifactMs !== null && closedAtMs > lastArtifactMs) {
      return {
        action: "noop",
        reason:
          `${CALIBRATION_REPAIR_TASK_ID} closed at ${new Date(closedAtMs).toISOString()} ` +
          `is more recent than the latest calibration artifact at ${new Date(lastArtifactMs).toISOString()}; ` +
          `gate is firing on pre-fix data and no post-fix builder run has written calibration evidence yet — ` +
          `let fresh artifacts accrue under the running critic prompt before re-opening the repair task.`,
        existingState: existing,
      };
    }
    return {
      action: "recreate",
      taskId: CALIBRATION_REPAIR_TASK_ID,
      previousState: existing as "done" | "dropped",
      target: "ready",
    };
  }
  return {
    action: "create",
    taskId: CALIBRATION_REPAIR_TASK_ID,
    target: "ready",
  };
}

export type CalibrationRepairApplied =
  | { kind: "noop"; reason: string; existingState: RepoTaskState }
  | { kind: "created"; taskId: string; path: string }
  | { kind: "recreated"; taskId: string; path: string; previousState: "done" | "dropped" }
  | { kind: "promoted"; taskId: string; move: MoveTaskResult };

/**
 * Apply the proposed action against the repo. Stages the resulting changes
 * with `git add` so the monitor's commit step picks them up alongside the
 * `commit-message.txt` and run-directory artifacts.
 */
export function applyCalibrationRepair(
  proposal: CalibrationRepairProposal,
  ctx: CalibrationRepairContext,
): CalibrationRepairApplied {
  if (proposal.action === "noop") {
    return {
      kind: "noop",
      reason: proposal.reason,
      existingState: proposal.existingState,
    };
  }

  if (proposal.action === "promote") {
    const move = moveTaskById(ctx.projectDir, proposal.taskId, "ready");
    return { kind: "promoted", taskId: proposal.taskId, move };
  }

  if (proposal.action === "recreate") {
    const previousPath = join(
      getRepoTaskStateDir(ctx.projectDir, proposal.previousState),
      `${proposal.taskId}.md`,
    );
    const targetPath = join(
      getRepoTaskStateDir(ctx.projectDir, "ready"),
      `${proposal.taskId}.md`,
    );
    mkdirSync(getRepoTaskStateDir(ctx.projectDir, "ready"), { recursive: true });
    if (existsSync(targetPath)) {
      throw new Error(
        `calibration-repair: refusing to overwrite existing ${targetPath} during recreate`,
      );
    }
    execFileSync("git", ["mv", previousPath, targetPath], {
      cwd: ctx.projectDir,
      env: withProtectedGitBareRepositoryEnv(),
    });
    writeFileSync(
      targetPath,
      buildCalibrationRepairTaskFile(proposal.taskId, "ready", ctx),
      "utf-8",
    );
    execFileSync("git", ["add", targetPath], {
      cwd: ctx.projectDir,
      env: withProtectedGitBareRepositoryEnv(),
    });
    return {
      kind: "recreated",
      taskId: proposal.taskId,
      path: targetPath.slice(ctx.projectDir.length + 1),
      previousState: proposal.previousState,
    };
  }

  // action === "create"
  const targetDir = getRepoTaskStateDir(ctx.projectDir, "ready");
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, `${proposal.taskId}.md`);
  if (existsSync(targetPath)) {
    throw new Error(
      `calibration-repair: target file already exists at ${targetPath} but proposer said no existing task — disk state changed mid-run`,
    );
  }
  writeFileSync(
    targetPath,
    buildCalibrationRepairTaskFile(proposal.taskId, "ready", ctx),
    "utf-8",
  );
  execFileSync("git", ["add", targetPath], {
    cwd: ctx.projectDir,
    env: withProtectedGitBareRepositoryEnv(),
  });
  return {
    kind: "created",
    taskId: proposal.taskId,
    path: targetPath.slice(ctx.projectDir.length + 1),
  };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function describeDriftKinds(kinds: readonly CalibrationDriftKind[]): string {
  return kinds.join(", ");
}

function buildCalibrationRepairTaskFile(
  taskId: string,
  state: "ready",
  ctx: CalibrationRepairContext,
): string {
  const attrs: Record<string, string> = {
    id: taskId,
    title: "Repair evaluator calibration drift",
    status: state,
    priority: "p1",
    area: "autonomy",
    summary:
      "Restore the live-run evaluator calibration loop to within threshold by tightening critic guidance, repair-loop checks, or the calibration gate itself.",
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso,
  };

  const body = buildCalibrationRepairTaskBody(ctx);
  return serializeFlatFrontMatter(attrs, body);
}

function buildCalibrationRepairTaskBody(ctx: CalibrationRepairContext): string {
  const { aggregate, driftKinds } = ctx;
  const lines: string[] = [
    "",
    "## Problem",
    "",
    "The live-run evaluator calibration gate fired in the last builder commit.",
    "That signal turns into a typed `evaluator-calibration.regression.detected`",
    "event and an attention-digest entry, but it must also turn into a concrete",
    "repair: the critic, repair-loop checks, prompt guidance, or the gate",
    "configuration itself need to change so the rate returns within threshold.",
    "",
    `Drift kind(s): ${describeDriftKinds(driftKinds)}.`,
    "",
    "Decision reason from the monitor:",
    "",
    `> ${ctx.decisionReason.replace(/\n/g, "\n> ")}`,
    "",
    "## Calibration Snapshot",
    "",
    `- Window: ${new Date(aggregate.windowStartMs).toISOString()} → ${new Date(aggregate.windowEndMs).toISOString()}`,
    `- Total runs in window: ${aggregate.totalRuns}`,
    `- Pass verdicts: ${aggregate.byVerdict.pass}`,
    `- Pass-with-warnings verdicts: ${aggregate.byVerdict.pass_with_warnings}`,
    `- Fail verdicts: ${aggregate.byVerdict.fail}`,
    `- Absent verdicts: ${aggregate.byVerdict.absent}`,
    `- Pass-contradiction rate: ${pct(aggregate.passContradictionRate)} (${aggregate.passContradictionCount} of ${aggregate.byVerdict.pass}); threshold ${pct(ctx.thresholdRate)}.`,
    `- Pass-with-warnings follow-up rate: ${pct(aggregate.passWithWarningsFollowUpRate)} (${aggregate.passWithWarningsFollowUpCount} of ${aggregate.byVerdict.pass_with_warnings}); threshold ${pct(ctx.passWithWarningsThresholdRate)}.`,
    "",
    "## Desired Outcome",
    "",
    "Either:",
    "",
    "- the underlying calibration drift is fixed (tighten critic guidance,",
    "  introduce a sharper repair-loop check, raise the bar for accepted",
    "  warnings, fix a prompt that lets the critic accept weak evidence); or",
    "- the threshold is intentionally widened with a recorded reason (the",
    "  current rate is the new healthy floor for the changed workload).",
    "",
    "Either way, the next monitor run should land back at `under-threshold` or",
    "`insufficient-sample` for the relevant kind, and that result must be",
    "visible in the run artifact rather than only in attention digests.",
    "",
    "## Constraints",
    "",
    "- Keep critic input artifact-only (diff, repo state, run artifacts,",
    "  optional runtime probe). Do not feed thinking traces or self-reports.",
    "- Do not silence the gate by raising the threshold without a documented",
    "  rationale committed alongside the threshold change.",
    "- Keep operator-facing notification surfaces (attention digest) working —",
    "  this task is in addition to that bridge, not instead of it.",
    "- Do not add a parallel lessons store or audit surface.",
    "",
    "## Done When",
    "",
    "1. The drift kind named above is no longer firing on the last calibration",
    "   sample, OR the gate config has been deliberately retuned with a",
    "   recorded rationale.",
    "2. Recent critic verdicts that were treated as `pass`/`pass_with_warnings`",
    "   despite weak evidence have been re-classified by tighter guidance, a",
    "   sharper repair-loop check, or follow-up tasks created for accepted",
    "   trade-offs.",
    "3. A run-directory artifact (`calibration-repair.json` or equivalent)",
    "   shows the post-fix calibration aggregate moving back within threshold.",
    "",
    "## Source / Intent",
    "",
    "Auto-created by `evaluator-calibration-monitor` after the live calibration",
    `gate fired at ${ctx.nowIso}. Replaces the previous notification-only`,
    "behavior so calibration drift becomes a deterministic next action in the",
    "queue rather than a recurring attention item.",
    "",
    "## Initiative",
    "",
    "Autonomy execution quality: builder success should mean proven completion,",
    "not only a clean commit with advisory caveats.",
    "",
    "## Acceptance Evidence",
    "",
    "- Test output for the calibration repair / critic classification fixtures.",
    "- A monitor run-directory artifact showing the gate back within threshold,",
    "  or the recorded rationale for retuning it.",
    "- Updated scoped autonomy guidance naming which critic warning classes",
    "  must fail, track follow-up, or pass as harmless.",
    "",
  ];
  return lines.join("\n");
}

export type CalibrationRepairArtifact = {
  decisionReason: string;
  driftKinds: readonly CalibrationDriftKind[];
  proposal: CalibrationRepairProposal;
  applied: CalibrationRepairApplied;
  aggregate: EvaluatorCalibrationAggregate;
  thresholdRate: number;
  passWithWarningsThresholdRate: number;
  generatedAt: string;
};

export function readExistingCalibrationRepairTask(
  projectDir: string,
): { state: RepoTaskState; content: string } | null {
  const tasksDir = getRepoTasksDir(projectDir);
  for (const state of REPO_TASK_STATES) {
    const candidate = join(tasksDir, state, `${CALIBRATION_REPAIR_TASK_ID}.md`);
    if (existsSync(candidate)) {
      return { state, content: readFileSync(candidate, "utf-8") };
    }
  }
  return null;
}
