import { join } from "node:path";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type { WorkflowTerminalFinalizerInput } from "#core/workflow/types.js";
import { recordFailedBuilderCalibration } from "./failed-calibration-finalizer.js";
import { emitBuilderRecoveryRequest } from "./recovery-continuation.js";
import { builderTerminalWorktreeFinalizerOperation } from "./terminal-worktree-finalizer-operation.js";

type BuilderTerminalWorkspace = {
  taskId: string;
  worktreeRunId: string;
};

type FailedBuilderCalibrationOperationInput = Pick<
  WorkflowTerminalFinalizerInput,
  "projectDir" | "workspaceDir" | "metadata" | "trigger" | "agentFailureKind"
>;

export function recordFailedBuilderCalibrationInWorker(
  input: FailedBuilderCalibrationOperationInput,
): string[] {
  const logMessages: string[] = [];
  const runBlocking: WorkflowTerminalFinalizerInput["runBlocking"] = async () => {
    throw new Error("Nested blocking operations are unavailable in a worker");
  };
  recordFailedBuilderCalibration({
    ...input,
    runBlocking,
    emit: () => {},
    log: (message) => logMessages.push(message),
  });
  return logMessages;
}

const recordFailedBuilderCalibrationOperation =
  defineWorkflowBlockingOperation<
    FailedBuilderCalibrationOperationInput,
    string[]
  >(import.meta.url, "recordFailedBuilderCalibrationInWorker");

function requiresFailedBuilderCalibrationInspection(
  input: WorkflowTerminalFinalizerInput,
): boolean {
  const buildStep = input.metadata.steps.find((step) => step.id === "build");
  return input.metadata.status === "failed" && buildStep?.status === "failed";
}

function workspaceOutput(
  input: WorkflowTerminalFinalizerInput,
): BuilderTerminalWorkspace | null {
  const step = input.metadata.steps.find(
    (candidate) => candidate.id === "prepare-worktree",
  );
  const output = step?.output;
  if (output && typeof output === "object") {
    const candidate = output as {
      enabled?: boolean;
      taskId?: string;
      worktreeRunId?: string;
    };
    if (candidate.enabled === true && typeof candidate.taskId === "string") {
      return {
        taskId: candidate.taskId,
        worktreeRunId: candidate.worktreeRunId ?? input.metadata.id,
      };
    }
    if (candidate.enabled === false) return null;
  }
  const claimOutput = input.metadata.steps.find(
    (candidate) => candidate.id === "claim-task",
  )?.output;
  if (!claimOutput || typeof claimOutput !== "object") return null;
  const claim = claimOutput as {
    claimed?: boolean;
    taskId?: string;
    claim?: { worktreeRunId?: string } | null;
  };
  if (claim.claimed !== true || typeof claim.taskId !== "string") return null;
  return {
    taskId: claim.taskId,
    worktreeRunId: claim.claim?.worktreeRunId ?? input.metadata.id,
  };
}

export async function finalizeBuilderTerminalWorktree(
  input: WorkflowTerminalFinalizerInput,
): Promise<void> {
  if (requiresFailedBuilderCalibrationInspection(input)) {
    try {
      const calibrationLogMessages = await input.runBlocking(
        recordFailedBuilderCalibrationOperation,
        {
          projectDir: input.projectDir,
          workspaceDir: input.workspaceDir,
          metadata: input.metadata,
          trigger: input.trigger,
          ...(input.agentFailureKind === undefined
            ? {}
            : { agentFailureKind: input.agentFailureKind }),
        },
      );
      for (const message of calibrationLogMessages) input.log(message);
    } catch (error) {
      input.log(
        `Builder terminal finalizer could not record calibration: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } else {
    // The helper returns before repository inspection unless this is a failed
    // builder step, so the cheap terminal-state guard stays inline.
    recordFailedBuilderCalibration(input);
  }
  const workspace = workspaceOutput(input);
  if (!workspace) return;
  const result = await input.runBlocking(
    builderTerminalWorktreeFinalizerOperation,
    {
      projectDir: input.projectDir,
      metadata: input.metadata,
      triggerEvent: input.trigger.event,
      ...(input.agentFailureKind !== undefined
        ? { agentFailureKind: input.agentFailureKind }
        : {}),
      workspace,
      artifactPath: join(
        input.projectDir,
        input.metadata.runDir,
        "terminal-worktree-finalizer.json",
      ),
    },
  );
  for (const message of result.logMessages) input.log(message);
  if (result.recoveryRequest !== null) {
    emitBuilderRecoveryRequest(input.emit, result.recoveryRequest);
  }
}
