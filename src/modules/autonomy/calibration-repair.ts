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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import {
  getRepoTaskStateDir,
  getRepoTasksDir,
  type MoveTaskResult,
  moveTaskById,
  REPO_TASK_STATES,
  type RepoTaskState,
  writeRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { inspectCalibrationRepairFreshness } from "./calibration-repair-freshness.js";
import { buildCalibrationRepairTaskFile } from "./calibration-repair-task.js";
import type {
  CalibrationDriftKind,
  CalibrationGateDecision,
  EvaluatorCalibrationAggregate,
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
 * Decide what to do about the calibration repair task. Pure: reads disk to
 * find the current state, but does not mutate.
 */
export async function proposeCalibrationRepair(
  ctx: CalibrationRepairContext,
  runCommand: WorkflowCommandRunner,
): Promise<CalibrationRepairProposal> {
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
    // A source-changing repair commit is reviewed and calibrated by the
    // pre-restart daemon. Concurrent builders may also finish afterward from
    // branches based before the fix. Wall-clock ordering therefore cannot
    // prove that the repaired evaluator has observed a run; require a source
    // revision descended from the commit that closed the repair task.
    const previousTaskPath = join(
      getRepoTaskStateDir(ctx.projectDir, existing),
      `${CALIBRATION_REPAIR_TASK_ID}.md`,
    );
    const freshness = await inspectCalibrationRepairFreshness(
      ctx.projectDir,
      previousTaskPath,
      CALIBRATION_REPAIR_TASK_ID,
      runCommand,
    );
    if (freshness.status !== "descendant-observed") {
      const evidenceReason =
        freshness.status === "awaiting-descendant"
          ? `no calibration artifact is based on repair ${freshness.repairRevision} or a descendant revision`
          : "the repair-closing revision is unavailable";
      return {
        action: "noop",
        reason:
          `${CALIBRATION_REPAIR_TASK_ID} remains closed because ${evidenceReason}; ` +
          `later wall-clock artifacts can still belong to the closing run or a concurrent pre-fix branch — ` +
          `let a descendant builder run exercise the repaired evaluator before re-opening the task.`,
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
    const targetPath = join(
      getRepoTaskStateDir(ctx.projectDir, "ready"),
      `${proposal.taskId}.md`,
    );
    if (existsSync(targetPath)) {
      throw new Error(
        `calibration-repair: refusing to overwrite existing ${targetPath} during recreate`,
      );
    }
    const move = moveTaskById(ctx.projectDir, proposal.taskId, "ready");
    writeRepoTaskFile(
      ctx.projectDir,
      targetPath,
      buildCalibrationRepairTaskFile(proposal.taskId, "ready", ctx),
    );
    return {
      kind: "recreated",
      taskId: proposal.taskId,
      path: move.path,
      previousState: proposal.previousState,
    };
  }

  // action === "create"
  const targetDir = getRepoTaskStateDir(ctx.projectDir, "ready");
  const targetPath = join(targetDir, `${proposal.taskId}.md`);
  if (existsSync(targetPath)) {
    throw new Error(
      `calibration-repair: target file already exists at ${targetPath} but proposer said no existing task — disk state changed mid-run`,
    );
  }
  writeRepoTaskFile(
    ctx.projectDir,
    targetPath,
    buildCalibrationRepairTaskFile(proposal.taskId, "ready", ctx),
  );
  return {
    kind: "created",
    taskId: proposal.taskId,
    path: targetPath.slice(ctx.projectDir.length + 1),
  };
}

export type CalibrationRepairArtifact = {
  runId: string;
  workflow: string;
  triggerEvent: string;
  sourceRunId: string | null;
  criticPromptHash: string;
  gateStatus: CalibrationGateDecision["status"];
  decisionReason: string;
  driftKinds: readonly CalibrationDriftKind[];
  /** Null when the aggregate does not require a queue mutation. */
  proposal: CalibrationRepairProposal | null;
  /** Null when no proposal was applied, including dirty-worktree skips. */
  applied: CalibrationRepairApplied | null;
  aggregate: EvaluatorCalibrationAggregate;
  thresholdRate: number;
  minSample: number;
  passWithWarningsThresholdRate: number;
  passWithWarningsMinSample: number;
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
