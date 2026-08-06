import { mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { formatRunId, validateWorkflowRunId } from "#core/workflow/run-io.js";
import type {
  WorkflowStateRecoveryArtifact,
  WorkflowStateRecoveryClaim,
  WorkflowStateRecoveryResolveInput,
} from "#modules/workflow-ops/state-recovery-provider.js";
import { recordAutonomyIssueRecoveryDisposition } from "./autonomy-issue-projection.js";

function artifactPath(input: WorkflowStateRecoveryResolveInput): string {
  const runId = input.artifactRunId === undefined
    ? formatRunId("workflow-state-recovery")
    : validateWorkflowRunId(
        input.artifactRunId,
        "Workflow state recovery artifactRunId",
      );
  return join(input.projectDir, ".kota", "runs", runId, "workflow-state-recovery.json");
}

function writeArtifact(
  path: string,
  artifact: WorkflowStateRecoveryArtifact,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeJsonFileAtomic(path, artifact);
}

function buildArtifact(input: {
  resolveInput: WorkflowStateRecoveryResolveInput;
  before: WorkflowStateRecoveryClaim | null;
  after: WorkflowStateRecoveryClaim | null;
  result: WorkflowStateRecoveryArtifact["result"];
  message: string;
  createdAt: string;
  dismissedDeadLetterIds?: string[];
  worktreeCleanup?: WorkflowStateRecoveryArtifact["worktreeCleanup"];
  taskMove?: WorkflowStateRecoveryArtifact["taskMove"];
}): WorkflowStateRecoveryArtifact {
  return {
    schemaVersion: 1,
    createdAt: input.createdAt,
    projectDir: input.resolveInput.projectDir,
    actor: input.resolveInput.actor ?? "workflow-state-recovery",
    taskId: input.resolveInput.taskId,
    requestedRunId: input.resolveInput.runId ?? null,
    action: input.resolveInput.action,
    rationale: input.resolveInput.rationale,
    before: input.before,
    after: input.after,
    relatedDeadLetters: input.before?.relatedDeadLetters ?? [],
    ...(input.dismissedDeadLetterIds !== undefined
      ? { dismissedDeadLetterIds: input.dismissedDeadLetterIds }
      : {}),
    ...(input.worktreeCleanup !== undefined ? { worktreeCleanup: input.worktreeCleanup } : {}),
    ...(input.taskMove !== undefined ? { taskMove: input.taskMove } : {}),
    result: input.result,
    message: input.message,
  };
}

export function finishResolve(input: {
  resolveInput: WorkflowStateRecoveryResolveInput;
  before: WorkflowStateRecoveryClaim | null;
  after: WorkflowStateRecoveryClaim | null;
  result: WorkflowStateRecoveryArtifact["result"];
  message: string;
  dismissedDeadLetterIds?: string[];
  worktreeCleanup?: WorkflowStateRecoveryArtifact["worktreeCleanup"];
  taskMove?: WorkflowStateRecoveryArtifact["taskMove"];
}): { artifactPath: string; artifact: WorkflowStateRecoveryArtifact } {
  const path = artifactPath(input.resolveInput);
  const artifact = buildArtifact({
    ...input,
    createdAt: new Date().toISOString(),
  });
  writeArtifact(path, artifact);
  recordAutonomyIssueRecoveryDisposition({
    projectDir: input.resolveInput.projectDir,
    taskId: input.resolveInput.taskId,
    recoveryDispositionRef: relative(input.resolveInput.projectDir, path),
    recordedAt: artifact.createdAt,
  });
  return { artifactPath: path, artifact };
}
