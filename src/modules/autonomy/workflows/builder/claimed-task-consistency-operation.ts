import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { listWorkflowMutatedPaths } from "#core/workflow/steps/agent-write-scope.js";
import { releaseTaskClaim } from "#modules/autonomy/task-claims.js";
import { findTerminalTasksInChangedFiles } from "./run-summary.js";

export type ClaimedTaskConsistencyResult = {
  matched: true;
  taskId: string;
  claimedTaskId: string;
  completedTaskId: string;
};

type ClaimedTaskConsistencyInput = {
  projectDir: string;
  workspaceDir: string;
  claimedTaskId: string;
  runId: string;
  workflowName: string;
};

function releaseMismatchedClaim(
  input: ClaimedTaskConsistencyInput,
  reason: string,
): void {
  const release = releaseTaskClaim({
    projectDir: input.projectDir,
    taskId: input.claimedTaskId,
    runId: input.runId,
    workflowId: input.workflowName,
    evidence: `builder claimed-task consistency failed before commit: ${reason}`,
  });
  if (!release.safeToRetry) {
    throw new Error(
      `Builder claimed ${input.claimedTaskId} but could not release the task claim after ${reason}: ` +
        (release.reason ?? release.recoveryStatus),
    );
  }
}

export function checkClaimedTaskConsistencyInWorker(
  input: ClaimedTaskConsistencyInput,
): ClaimedTaskConsistencyResult {
  const terminalTasks = findTerminalTasksInChangedFiles(
    input.workspaceDir,
    listWorkflowMutatedPaths(input.workspaceDir),
  );
  const completedTasks = terminalTasks.some((task) => task.becameTerminal)
    ? terminalTasks.filter((task) => task.becameTerminal)
    : terminalTasks;
  if (completedTasks.length === 0) {
    releaseMismatchedClaim(input, "no terminal task in the pre-commit set");
    throw new Error(
      `Builder claimed ${input.claimedTaskId} but the pre-commit set did not identify a completed task; ` +
        "released the task claim for retry and refusing to commit",
    );
  }
  const matchingTask = completedTasks.find(
    (task) => task.taskId === input.claimedTaskId,
  );
  if (matchingTask === undefined) {
    const completedTaskId = completedTasks[0]?.taskId ?? "unknown";
    releaseMismatchedClaim(
      input,
      `pre-commit set identified ${completedTaskId}`,
    );
    throw new Error(
      `Builder claimed ${input.claimedTaskId} but the pre-commit set identified ${completedTaskId}; ` +
        "released the task claim for retry and refusing to commit or emit workflow.build.committed",
    );
  }
  const otherCompletedTasks = completedTasks.filter(
    (task) => task.taskId !== input.claimedTaskId,
  );
  if (otherCompletedTasks.length > 0) {
    const otherTaskIds = otherCompletedTasks.map((task) => task.taskId).join(", ");
    releaseMismatchedClaim(
      input,
      `pre-commit set also completed ${otherTaskIds}`,
    );
    throw new Error(
      `Builder claimed ${input.claimedTaskId} but the pre-commit set also completed ${otherTaskIds}; ` +
        "released the task claim for retry and refusing to commit or emit workflow.build.committed",
    );
  }

  return {
    matched: true,
    taskId: input.claimedTaskId,
    claimedTaskId: input.claimedTaskId,
    completedTaskId: matchingTask.taskId,
  };
}

export const claimedTaskConsistencyOperation = defineWorkflowBlockingOperation<
  ClaimedTaskConsistencyInput,
  ClaimedTaskConsistencyResult
>(import.meta.url, "checkClaimedTaskConsistencyInWorker");
