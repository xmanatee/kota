import { join } from "node:path";
import type { WorkflowTerminalFinalizerInput } from "#core/workflow/types.js";
import { emitBuilderRecoveryRequest } from "./recovery-continuation.js";
import { builderTerminalWorktreeFinalizerOperation } from "./terminal-worktree-finalizer-operation.js";

type BuilderTerminalWorkspace = {
  taskId: string;
  worktreeRunId: string;
};

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
