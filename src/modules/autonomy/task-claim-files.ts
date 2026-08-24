import { join } from "node:path";
import type { KotaJsonObject, KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunStatus } from "#core/workflow/run-types.js";
import { isAutomationWorktreeCanonicalReconciliation } from "#modules/git/worktree-canonical-reconciliation-record.js";
import {
  type AutomationWorktreeOperatorStatus,
  listAutomationWorktreeStatuses,
} from "#modules/git/worktree-lifecycle.js";
import {
  REPO_TASK_STATES,
  REPO_TASKS_DIR,
  type RepoTaskState,
  readVerifiedRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  type ClaimFileIdentity,
  runClaimFilesystemOperation,
} from "./task-claim-filesystem.js";
import {
  isTaskClaimContentDigest,
  taskClaimContentDigest,
  taskClaimContractDigest,
} from "./task-claim-task-binding.js";
import {
  ACTIVE_CLAIMS_DIR,
  CLAIM_SCHEMA_VERSION,
  type ClaimTaskInput,
  type ContinueTaskClaimInput,
  DEFAULT_TASK_CLAIM_LEASE_MS,
  safeTaskClaimSegment,
  type TaskClaim,
  type TaskClaimInspection,
  type TaskClaimStatus,
} from "./task-claim-types.js";

function claimFilesystemFail(reason: string): never {
  throw new Error(`Task claim filesystem: ${reason}`);
}

function claimFileName(taskId: string): string {
  return `${safeTaskClaimSegment(taskId)}.json`;
}

export function taskClaimPath(projectDir: string, taskId: string): string {
  return join(projectDir, ACTIVE_CLAIMS_DIR, claimFileName(taskId));
}

function claimHistoryLocation(claim: TaskClaim, now: Date): {
  historyTaskSegment: string;
  historyFileName: string;
} {
  return {
    historyTaskSegment: safeTaskClaimSegment(claim.taskId),
    historyFileName:
      `${safeTaskClaimSegment(now.toISOString())}-${safeTaskClaimSegment(claim.runId)}-${claim.status}.json`,
  };
}

function isTaskClaimStatus(value: string | undefined): value is TaskClaimStatus {
  return value === "active" ||
    value === "pending-decomposition" ||
    value === "pending-merge" ||
    value === "released" ||
    value === "expired" ||
    value === "superseded";
}

function isRepoTaskState(value: string | undefined): value is RepoTaskState {
  return REPO_TASK_STATES.includes(value as RepoTaskState);
}

function isTaskFileDescriptor(
  value: TaskClaim["taskFile"] | undefined,
  taskId: string | undefined,
  taskState: RepoTaskState | undefined,
): value is TaskClaim["taskFile"] {
  if (
    value === undefined ||
    value === null ||
    typeof value !== "object" ||
    taskId === undefined ||
    taskState === undefined ||
    typeof value.path !== "string" ||
    value.snapshot === undefined ||
    value.snapshot === null ||
    typeof value.snapshot !== "object" ||
    value.path !== join(REPO_TASKS_DIR, taskState, `${taskId}.md`)
  ) {
    return false;
  }
  const snapshot = value.snapshot;
  return (
    Number.isSafeInteger(snapshot.dev) &&
    Number.isSafeInteger(snapshot.ino) &&
    Number.isSafeInteger(snapshot.size) &&
    snapshot.size >= 0 &&
    Number.isFinite(snapshot.mtimeMs) &&
    Number.isFinite(snapshot.ctimeMs)
  );
}

type OwnerRunStatus = WorkflowRunStatus | "running";

function isJsonObject(value: KotaJsonValue | undefined): value is KotaJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOwnerRunStatus(value: KotaJsonValue | undefined): value is OwnerRunStatus {
  return (
    value === "running" ||
    value === "success" ||
    value === "failed" ||
    value === "yielded" ||
    value === "interrupted" ||
    value === "completed-with-warnings"
  );
}

function isInactiveTerminalRunStatus(value: OwnerRunStatus): boolean {
  return value === "failed" || value === "yielded" || value === "interrupted";
}

function readOwnerRunStatus(projectDir: string, claim: TaskClaim): OwnerRunStatus | null {
  const metadataPath = join(projectDir, ".kota", "runs", claim.runId, "metadata.json");
  const metadata = readOptionalJsonFile<KotaJsonValue>(metadataPath);
  if (metadata === null) return null;
  if (!isJsonObject(metadata)) {
    throw new Error(`Malformed owner workflow run metadata: ${metadataPath}`);
  }
  if (
    metadata.id !== claim.runId ||
    metadata.workflow !== claim.workflowId ||
    !isOwnerRunStatus(metadata.status)
  ) {
    throw new Error(`Malformed owner workflow run metadata: ${metadataPath}`);
  }
  return metadata.status;
}

type StoredTaskClaim = Omit<Partial<TaskClaim>, "schemaVersion"> & {
  schemaVersion?: number;
};

function parseClaimFile(
  projectDir: string,
  path: string,
  content: string,
  requestedTaskId: string,
): TaskClaim {
  const parsed = JSON.parse(content) as StoredTaskClaim;
  if (
    parsed.taskId !== requestedTaskId ||
    !isRepoTaskState(parsed.taskState) ||
    typeof parsed.runId !== "string" ||
    (parsed.worktreeRunId !== undefined && typeof parsed.worktreeRunId !== "string") ||
    typeof parsed.workflowId !== "string" ||
    typeof parsed.owner !== "string" ||
    typeof parsed.workspaceDir !== "string" ||
    typeof parsed.branch !== "string" ||
    typeof parsed.baseCommit !== "string" ||
    (parsed.canonicalReconciliation !== undefined &&
      (!isAutomationWorktreeCanonicalReconciliation(parsed.canonicalReconciliation) ||
        parsed.canonicalReconciliation.originalBaseCommit !== parsed.baseCommit)) ||
    typeof parsed.leaseMs !== "number" ||
    typeof parsed.leaseAcquiredAt !== "string" ||
    typeof parsed.leaseExpiresAt !== "string" ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    (parsed.taskContentDigest !== undefined &&
      !isTaskClaimContentDigest(parsed.taskContentDigest)) ||
    (parsed.taskContractDigest !== undefined &&
      !isTaskClaimContentDigest(parsed.taskContractDigest)) ||
    !isTaskClaimStatus(parsed.status)
  ) {
    throw new Error(`Malformed task claim file: ${path}`);
  }
  let taskState = parsed.taskState;
  let taskFile = parsed.taskFile;
  if (parsed.schemaVersion === 1) {
    // Version 1 claims predate verified queue identities. Resolve their
    // current canonical task once through the no-follow boundary so recovery
    // remains available without treating the old claim as proof for a new
    // decomposer prompt.
    taskFile = undefined;
    const candidateStates = [
      taskState,
      ...REPO_TASK_STATES.filter((state) => state !== taskState),
    ];
    for (const state of candidateStates) {
      const currentTask = readVerifiedRepoTaskFile(projectDir, state, parsed.taskId);
      if (currentTask !== null) {
        taskState = state;
        taskFile = {
          path: currentTask.path,
          snapshot: currentTask.snapshot,
        };
        break;
      }
    }
  }
  if (
    (parsed.schemaVersion !== CLAIM_SCHEMA_VERSION && parsed.schemaVersion !== 1) ||
    !isTaskFileDescriptor(taskFile, parsed.taskId, taskState)
  ) {
    throw new Error(`Malformed task claim file: ${path}`);
  }
  return {
    schemaVersion: CLAIM_SCHEMA_VERSION,
    taskId: parsed.taskId,
    taskState,
    taskFile,
    ...(parsed.taskContentDigest !== undefined
      ? { taskContentDigest: parsed.taskContentDigest }
      : {}),
    ...(parsed.taskContractDigest !== undefined
      ? { taskContractDigest: parsed.taskContractDigest }
      : {}),
    runId: parsed.runId,
    ...(parsed.worktreeRunId !== undefined
      ? { worktreeRunId: parsed.worktreeRunId }
      : {}),
    workflowId: parsed.workflowId,
    owner: parsed.owner,
    workspaceDir: parsed.workspaceDir,
    branch: parsed.branch,
    baseCommit: parsed.baseCommit,
    ...(parsed.canonicalReconciliation !== undefined
      ? { canonicalReconciliation: parsed.canonicalReconciliation }
      : {}),
    leaseMs: parsed.leaseMs,
    leaseAcquiredAt: parsed.leaseAcquiredAt,
    leaseExpiresAt: parsed.leaseExpiresAt,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    status: parsed.status,
    evidence: typeof parsed.evidence === "string" ? parsed.evidence : null,
  };
}

export function writeClaim(
  projectDir: string,
  claim: TaskClaim,
  flag: "w" | "wx",
): void {
  const response = runClaimFilesystemOperation(projectDir, {
    operation: "write-active",
    taskId: claim.taskId,
    fileName: claimFileName(claim.taskId),
    content: `${JSON.stringify(claim, null, 2)}\n`,
    flag,
  });
  if (response.writeConflict) {
    const error = new Error("Task claim already exists") as NodeJS.ErrnoException;
    error.code = "EEXIST";
    throw error;
  }
}

function sameClaim(left: TaskClaim, right: TaskClaim): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.taskId === right.taskId &&
    left.taskState === right.taskState &&
    left.taskFile.path === right.taskFile.path &&
    left.taskFile.snapshot.dev === right.taskFile.snapshot.dev &&
    left.taskFile.snapshot.ino === right.taskFile.snapshot.ino &&
    left.taskFile.snapshot.size === right.taskFile.snapshot.size &&
    left.taskFile.snapshot.mtimeMs === right.taskFile.snapshot.mtimeMs &&
    left.taskFile.snapshot.ctimeMs === right.taskFile.snapshot.ctimeMs &&
    left.taskContentDigest === right.taskContentDigest &&
    left.taskContractDigest === right.taskContractDigest &&
    left.runId === right.runId &&
    left.worktreeRunId === right.worktreeRunId &&
    left.workflowId === right.workflowId &&
    left.owner === right.owner &&
    left.workspaceDir === right.workspaceDir &&
    left.branch === right.branch &&
    left.baseCommit === right.baseCommit &&
    JSON.stringify(left.canonicalReconciliation) ===
      JSON.stringify(right.canonicalReconciliation) &&
    left.leaseMs === right.leaseMs &&
    left.leaseAcquiredAt === right.leaseAcquiredAt &&
    left.leaseExpiresAt === right.leaseExpiresAt &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.status === right.status &&
    left.evidence === right.evidence;
}

type ClaimMutationLock = {
  fileName: string;
  identity: ClaimFileIdentity;
};

function acquireClaimMutationLock(
  projectDir: string,
  claim: TaskClaim,
  now: Date,
): ClaimMutationLock | null {
  const fileName = `${safeTaskClaimSegment(claim.taskId)}.lock`;
  const response = runClaimFilesystemOperation(projectDir, {
    operation: "acquire-lock",
    lockFileName: fileName,
    content: `${claim.runId}\n${now.toISOString()}\n`,
  });
  if (response.acquired === false) return null;
  if (response.acquired !== true || response.lockIdentity === undefined) {
    return claimFilesystemFail("helper omitted an acquired lock identity");
  }
  return { fileName, identity: response.lockIdentity };
}

function releaseClaimMutationLock(
  projectDir: string,
  lock: ClaimMutationLock,
): void {
  runClaimFilesystemOperation(projectDir, {
    operation: "release-lock",
    lockFileName: lock.fileName,
    lockIdentity: lock.identity,
  });
}

function assertClaimTaskFileCurrent(input: ClaimTaskInput) {
  const current = readVerifiedRepoTaskFile(
    input.projectDir,
    input.taskState,
    input.taskId,
  );
  const expected = input.taskFile;
  if (
    current === null ||
    current.path !== expected.path ||
    current.snapshot.dev !== expected.snapshot.dev ||
    current.snapshot.ino !== expected.snapshot.ino ||
    current.snapshot.size !== expected.snapshot.size ||
    current.snapshot.mtimeMs !== expected.snapshot.mtimeMs ||
    current.snapshot.ctimeMs !== expected.snapshot.ctimeMs
  ) {
    throw new Error(
      `Cannot claim task ${input.taskId}: verified task file changed during queue selection`,
    );
  }
  return current;
}

export function buildClaim(input: ClaimTaskInput, now: Date, createdAt?: string): TaskClaim {
  const currentTask = assertClaimTaskFileCurrent(input);
  const leaseMs = input.leaseMs ?? DEFAULT_TASK_CLAIM_LEASE_MS;
  const acquiredAt = now.toISOString();
  return {
    schemaVersion: CLAIM_SCHEMA_VERSION,
    taskId: input.taskId,
    taskState: input.taskState,
    taskFile: input.taskFile,
    taskContentDigest: taskClaimContentDigest(currentTask.content),
    taskContractDigest: taskClaimContractDigest(currentTask.content),
    runId: input.runId,
    workflowId: input.workflowId,
    owner: input.owner,
    workspaceDir: input.workspaceDir,
    branch: input.branch,
    baseCommit: input.baseCommit,
    leaseMs,
    leaseAcquiredAt: acquiredAt,
    leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    createdAt: createdAt ?? acquiredAt,
    updatedAt: acquiredAt,
    status: "active",
    evidence: null,
  };
}

export function inspectTaskClaim(
  claim: TaskClaim,
  path: string,
  now: Date = new Date(),
): TaskClaimInspection {
  if (claim.status === "pending-decomposition") {
    return {
      claim,
      path,
      recoveryStatus: "pending-decomposition",
      safeToRetry: false,
    };
  }
  if (claim.status === "pending-merge") {
    return { claim, path, recoveryStatus: "pending-merge", safeToRetry: false };
  }
  if (claim.status === "expired") {
    return { claim, path, recoveryStatus: "expired", safeToRetry: true };
  }
  if (claim.status === "released") {
    return { claim, path, recoveryStatus: "released", safeToRetry: true };
  }
  if (claim.status === "superseded") {
    return { claim, path, recoveryStatus: "superseded", safeToRetry: true };
  }
  const expiresAt = Date.parse(claim.leaseExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return { claim, path, recoveryStatus: "stale", safeToRetry: true };
  }
  return { claim, path, recoveryStatus: "agent-running", safeToRetry: false };
}

export function inspectTaskClaimWithOwnerRun(
  projectDir: string,
  claim: TaskClaim,
  path: string,
  now: Date = new Date(),
  worktrees?: readonly AutomationWorktreeOperatorStatus[],
): TaskClaimInspection {
  let inspection = inspectTaskClaim(claim, path, now);
  if (inspection.recoveryStatus === "agent-running") {
    const ownerRunStatus = readOwnerRunStatus(projectDir, claim);
    if (ownerRunStatus !== null && isInactiveTerminalRunStatus(ownerRunStatus)) {
      inspection = { claim, path, recoveryStatus: "stale", safeToRetry: true };
    }
  }
  if (
    inspection.recoveryStatus === "stale" &&
    (worktrees ?? listAutomationWorktreeStatuses(projectDir)).some(
      (worktree) =>
        worktree.taskId === claim.taskId &&
        worktree.runId === (claim.worktreeRunId ?? claim.runId) &&
        worktree.exists &&
        (worktree.dirtyState === "dirty" || worktree.dirtyState === "conflicted"),
    )
  ) {
    return { ...inspection, safeToRetry: false };
  }
  return inspection;
}

export function readActiveTaskClaim(projectDir: string, taskId: string): TaskClaim | null {
  const path = taskClaimPath(projectDir, taskId);
  const response = runClaimFilesystemOperation(projectDir, {
    operation: "read-active",
    taskId,
    fileName: claimFileName(taskId),
  });
  if (response.content === null) return null;
  if (response.content === undefined) {
    return claimFilesystemFail("helper omitted active claim content");
  }
  return parseClaimFile(projectDir, path, response.content, taskId);
}

export function listTaskClaimInspections(
  projectDir: string,
  now: Date = new Date(),
): TaskClaimInspection[] {
  return readTaskClaimInspectionStore(projectDir, now).items;
}

export function readTaskClaimInspectionStore(
  projectDir: string,
  now: Date = new Date(),
): { available: boolean; items: TaskClaimInspection[] } {
  const dir = join(projectDir, ACTIVE_CLAIMS_DIR);
  const response = runClaimFilesystemOperation(projectDir, { operation: "list-active" });
  if (response.entries === undefined || response.available === undefined) {
    return claimFilesystemFail("helper omitted active claim store state");
  }
  if (response.entries.length === 0) {
    return { available: response.available, items: [] };
  }
  const worktrees = listAutomationWorktreeStatuses(projectDir);
  const items = response.entries.map((entry) => {
    const path = join(dir, entry.name);
    return inspectTaskClaimWithOwnerRun(
      projectDir,
      parseClaimFile(projectDir, path, entry.content, entry.taskId),
      path,
      now,
      worktrees,
    );
  });
  return { available: response.available, items };
}

export function archiveClaim(projectDir: string, claim: TaskClaim, now: Date): void {
  runClaimFilesystemOperation(projectDir, {
    operation: "archive-active",
    taskId: claim.taskId,
    fileName: claimFileName(claim.taskId),
    ...claimHistoryLocation(claim, now),
  });
}

export function archiveClaimIfUnchanged(
  projectDir: string,
  expected: TaskClaim,
  now: Date,
): boolean {
  const lock = acquireClaimMutationLock(projectDir, expected, now);
  if (!lock) return false;
  try {
    const current = readActiveTaskClaim(projectDir, expected.taskId);
    if (current === null) return false;
    if (!sameClaim(current, expected)) return false;
    archiveClaim(projectDir, current, now);
    return true;
  } finally {
    releaseClaimMutationLock(projectDir, lock);
  }
}

export function continueClaimIfUnchanged(
  projectDir: string,
  expected: TaskClaim,
  input: ContinueTaskClaimInput,
): TaskClaim | null {
  const now = input.now ?? new Date();
  const lock = acquireClaimMutationLock(projectDir, expected, now);
  if (!lock) return null;
  try {
    const current = readActiveTaskClaim(projectDir, expected.taskId);
    if (current === null) return null;
    if (!sameClaim(current, expected)) return null;

    runClaimFilesystemOperation(projectDir, {
      operation: "copy-active-history",
      taskId: current.taskId,
      fileName: claimFileName(current.taskId),
      ...claimHistoryLocation(current, now),
    });
    const leaseMs = input.leaseMs ?? current.leaseMs;
    const acquiredAt = now.toISOString();
    const continued: TaskClaim = {
      ...current,
      runId: input.runId,
      worktreeRunId: current.worktreeRunId ?? current.runId,
      workflowId: input.workflowId,
      owner: input.owner,
      leaseMs,
      leaseAcquiredAt: acquiredAt,
      leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      updatedAt: acquiredAt,
      status: "active",
      evidence: input.evidence,
    };
    writeClaim(projectDir, continued, "w");
    return continued;
  } finally {
    releaseClaimMutationLock(projectDir, lock);
  }
}
