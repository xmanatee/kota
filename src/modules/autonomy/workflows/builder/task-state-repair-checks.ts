import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { listWorkflowMutatedPaths } from "#core/workflow/steps/agent-write-scope.js";
import type { QueueTaskClaimResult } from "#modules/autonomy/task-claims.js";
import { listTaskClaimInspections } from "#modules/autonomy/task-claims.js";
import { findTerminalTaskInChangedFiles } from "./run-summary.js";

function taskFilesInState(projectDir: string, state: "ready" | "doing" | "done" | "blocked"): string[] {
  const dir = join(projectDir, "data/tasks", state);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "AGENTS.md")
    .sort();
}

export function checkActionableTaskClaimed(
  projectDir: string,
  claimProjectDir = projectDir,
): string {
  const ready = taskFilesInState(projectDir, "ready");
  if (ready.length === 0) return "OK: no unclaimed ready task";

  const activeClaims = listTaskClaimInspections(claimProjectDir).filter(
    (inspection) => !inspection.safeToRetry,
  );
  if (activeClaims.length > 0) {
    return `OK: task claimed (${activeClaims.length} active lease(s))`;
  }

  const claimedCount =
    taskFilesInState(projectDir, "doing").length +
    taskFilesInState(projectDir, "done").length +
    taskFilesInState(projectDir, "blocked").length;
  if (claimedCount > 0) return `OK: task claimed (${claimedCount} active or terminal task file(s))`;

  throw new Error(
    `Builder has ${ready.length} ready task(s) but has not claimed one. ` +
      'Move one ready task to doing with `node "$KOTA_DIST_DIR/cli.js" task move <id> doing` ' +
      "or `pnpm kota task move <id> doing` in package projects, " +
      "then complete it or block it according to the task's Done When section.",
  );
}

export function checkActionableTaskResolved(projectDir: string): string {
  const doing = taskFilesInState(projectDir, "doing");
  if (doing.length === 0) return "OK: no in-progress task left open";

  throw new Error(
    `Builder still has ${doing.length} task(s) in doing: ${doing.join(", ")}. ` +
      "Before completing the workflow, move finished work to done or honestly move blocked work to blocked.",
  );
}

function nonEmptyTaskId(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function checkClaimedTaskCommitSet(
  projectDir: string,
  claim: QueueTaskClaimResult | undefined,
): string {
  const claimedTaskId = nonEmptyTaskId(claim?.taskId);
  if (claim?.claimed !== true || claimedTaskId === null) {
    throw new Error("Builder cannot validate the commit set without a claimed task id");
  }

  const task = findTerminalTaskInChangedFiles(
    projectDir,
    listWorkflowMutatedPaths(projectDir),
  );
  const commitTaskId = nonEmptyTaskId(task.taskId);
  if (commitTaskId === null) {
    throw new Error(
      `Builder claimed ${claimedTaskId} but the commit set does not identify a completed task. ` +
        "Move the claimed task to done, blocked, or dropped before stopping.",
    );
  }
  if (commitTaskId !== claimedTaskId) {
    throw new Error(
      `Builder claimed ${claimedTaskId} but the commit set identifies ${commitTaskId}. ` +
        "Finish only the claimed task in this run; move the claimed task to a terminal state " +
        "or revert the other task before stopping.",
    );
  }

  return `OK: commit set resolves claimed task ${claimedTaskId}`;
}
