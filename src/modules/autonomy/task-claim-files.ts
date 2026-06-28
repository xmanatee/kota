import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  REPO_TASK_STATES,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  ACTIVE_CLAIMS_DIR,
  CLAIM_HISTORY_DIR,
  CLAIM_SCHEMA_VERSION,
  CLAIMS_ROOT,
  type ClaimTaskInput,
  DEFAULT_TASK_CLAIM_LEASE_MS,
  safeTaskClaimSegment,
  type TaskClaim,
  type TaskClaimInspection,
  type TaskClaimStatus,
} from "./task-claim-types.js";

export function taskClaimPath(projectDir: string, taskId: string): string {
  return join(projectDir, ACTIVE_CLAIMS_DIR, `${safeTaskClaimSegment(taskId)}.json`);
}

function claimHistoryPath(projectDir: string, claim: TaskClaim, now: Date): string {
  return join(
    projectDir,
    CLAIM_HISTORY_DIR,
    safeTaskClaimSegment(claim.taskId),
    `${safeTaskClaimSegment(now.toISOString())}-${safeTaskClaimSegment(claim.runId)}-${claim.status}.json`,
  );
}

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function isTaskClaimStatus(value: string | undefined): value is TaskClaimStatus {
  return value === "active" || value === "pending-merge" || value === "released" || value === "expired";
}

function isRepoTaskState(value: string | undefined): value is RepoTaskState {
  return REPO_TASK_STATES.includes(value as RepoTaskState);
}

function readClaimFile(path: string): TaskClaim {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TaskClaim>;
  if (
    parsed.schemaVersion !== CLAIM_SCHEMA_VERSION ||
    typeof parsed.taskId !== "string" ||
    !isRepoTaskState(parsed.taskState) ||
    typeof parsed.runId !== "string" ||
    typeof parsed.workflowId !== "string" ||
    typeof parsed.owner !== "string" ||
    typeof parsed.workspaceDir !== "string" ||
    typeof parsed.branch !== "string" ||
    typeof parsed.baseCommit !== "string" ||
    typeof parsed.leaseMs !== "number" ||
    typeof parsed.leaseAcquiredAt !== "string" ||
    typeof parsed.leaseExpiresAt !== "string" ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    !isTaskClaimStatus(parsed.status)
  ) {
    throw new Error(`Malformed task claim file: ${path}`);
  }
  return {
    schemaVersion: CLAIM_SCHEMA_VERSION,
    taskId: parsed.taskId,
    taskState: parsed.taskState,
    runId: parsed.runId,
    workflowId: parsed.workflowId,
    owner: parsed.owner,
    workspaceDir: parsed.workspaceDir,
    branch: parsed.branch,
    baseCommit: parsed.baseCommit,
    leaseMs: parsed.leaseMs,
    leaseAcquiredAt: parsed.leaseAcquiredAt,
    leaseExpiresAt: parsed.leaseExpiresAt,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    status: parsed.status,
    evidence: typeof parsed.evidence === "string" ? parsed.evidence : null,
  };
}

export function writeClaim(path: string, claim: TaskClaim, flag: "w" | "wx"): void {
  ensureParent(path);
  writeFileSync(path, `${JSON.stringify(claim, null, 2)}\n`, {
    encoding: "utf8",
    flag,
  });
}

function taskClaimMutationLockPath(projectDir: string, taskId: string): string {
  return join(projectDir, CLAIMS_ROOT, "locks", `${safeTaskClaimSegment(taskId)}.lock`);
}

function sameClaim(left: TaskClaim, right: TaskClaim): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.taskId === right.taskId &&
    left.taskState === right.taskState &&
    left.runId === right.runId &&
    left.workflowId === right.workflowId &&
    left.owner === right.owner &&
    left.workspaceDir === right.workspaceDir &&
    left.branch === right.branch &&
    left.baseCommit === right.baseCommit &&
    left.leaseMs === right.leaseMs &&
    left.leaseAcquiredAt === right.leaseAcquiredAt &&
    left.leaseExpiresAt === right.leaseExpiresAt &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.status === right.status &&
    left.evidence === right.evidence;
}

function acquireClaimMutationLock(projectDir: string, claim: TaskClaim, now: Date): string | null {
  const lockPath = taskClaimMutationLockPath(projectDir, claim.taskId);
  ensureParent(lockPath);
  try {
    writeFileSync(lockPath, `${claim.runId}\n${now.toISOString()}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    return lockPath;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return null;
    }
    throw error;
  }
}

export function buildClaim(input: ClaimTaskInput, now: Date, createdAt?: string): TaskClaim {
  const leaseMs = input.leaseMs ?? DEFAULT_TASK_CLAIM_LEASE_MS;
  const acquiredAt = now.toISOString();
  return {
    schemaVersion: CLAIM_SCHEMA_VERSION,
    taskId: input.taskId,
    taskState: input.taskState,
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
  if (claim.status === "pending-merge") {
    return { claim, path, recoveryStatus: "pending-merge", safeToRetry: false };
  }
  if (claim.status === "expired") {
    return { claim, path, recoveryStatus: "expired", safeToRetry: true };
  }
  if (claim.status === "released") {
    return { claim, path, recoveryStatus: "released", safeToRetry: true };
  }
  const expiresAt = Date.parse(claim.leaseExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    return { claim, path, recoveryStatus: "stale", safeToRetry: true };
  }
  return { claim, path, recoveryStatus: "agent-running", safeToRetry: false };
}

export function readActiveTaskClaim(projectDir: string, taskId: string): TaskClaim | null {
  const path = taskClaimPath(projectDir, taskId);
  if (!existsSync(path)) return null;
  return readClaimFile(path);
}

export function listTaskClaimInspections(
  projectDir: string,
  now: Date = new Date(),
): TaskClaimInspection[] {
  const dir = join(projectDir, ACTIVE_CLAIMS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      return inspectTaskClaim(readClaimFile(path), path, now);
    });
}

export function archiveClaim(projectDir: string, path: string, claim: TaskClaim, now: Date): void {
  const historyPath = claimHistoryPath(projectDir, claim, now);
  ensureParent(historyPath);
  renameSync(path, historyPath);
}

export function archiveClaimIfUnchanged(
  projectDir: string,
  path: string,
  expected: TaskClaim,
  now: Date,
): boolean {
  const lockPath = acquireClaimMutationLock(projectDir, expected, now);
  if (!lockPath) return false;
  try {
    if (!existsSync(path)) return false;
    const current = readClaimFile(path);
    if (!sameClaim(current, expected)) return false;
    archiveClaim(projectDir, path, current, now);
    return true;
  } finally {
    unlinkSync(lockPath);
  }
}
