import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  isCanonicalTaskContent,
  isTaskClaimContentDigest,
  taskClaimContentDigest,
  taskClaimContractDigest,
} from "#modules/autonomy/task-claim-task-binding.js";
import {
  CLAIM_CANDIDATE_STATES,
  CLAIM_SCHEMA_VERSION,
  readActiveTaskClaim,
  type TaskClaim,
} from "#modules/autonomy/task-claims.js";
import {
  REPO_TASKS_DIR,
  type RepoTaskFileDescriptor,
  type RepoTaskState,
  readVerifiedRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export type DecompositionSource = {
  runId: string;
  runDir: string;
};

type BuilderTaskClaimArtifact = {
  claimed?: boolean;
  taskId?: string | null;
  claim: {
    schemaVersion?: number;
    taskId?: string;
    taskState?: RepoTaskState;
    runId?: string;
    workflowId?: string;
    status?: string;
    taskContentDigest?: string;
    taskContractDigest?: string;
    taskFile?: {
      path?: string;
      snapshot?: {
        dev?: number;
        ino?: number;
        size?: number;
        mtimeMs?: number;
        ctimeMs?: number;
      };
    };
  } | null;
};

type VerifiedBuilderTaskClaimArtifact = BuilderTaskClaimArtifact & {
  claimed: true;
  taskId: string;
  claim: {
    schemaVersion: typeof CLAIM_SCHEMA_VERSION;
    taskId: string;
    taskState: RepoTaskState;
    runId: string;
    workflowId: "builder";
    status: "active";
    taskContentDigest: string;
    taskContractDigest: string;
    taskFile: RepoTaskFileDescriptor;
  };
};

function isVerifiedClaimBinding(
  artifact: BuilderTaskClaimArtifact,
): artifact is VerifiedBuilderTaskClaimArtifact {
  const claim = artifact.claim;
  if (
    artifact.claimed !== true ||
    typeof artifact.taskId !== "string" ||
    claim === null ||
    claim === undefined ||
    claim.schemaVersion !== CLAIM_SCHEMA_VERSION ||
    claim.taskId !== artifact.taskId ||
    typeof claim.runId !== "string" ||
    claim.workflowId !== "builder" ||
    claim.status !== "active" ||
    !isTaskClaimContentDigest(claim.taskContentDigest) ||
    !isTaskClaimContentDigest(claim.taskContractDigest) ||
    claim.taskState === undefined ||
    !CLAIM_CANDIDATE_STATES.includes(claim.taskState) ||
    claim.taskFile === undefined ||
    claim.taskFile.snapshot === undefined ||
    claim.taskFile.path !==
      join(REPO_TASKS_DIR, claim.taskState, `${artifact.taskId}.md`)
  ) {
    return false;
  }
  const snapshot = claim.taskFile.snapshot;
  return (
    typeof snapshot.dev === "number" &&
    Number.isSafeInteger(snapshot.dev) &&
    typeof snapshot.ino === "number" &&
    Number.isSafeInteger(snapshot.ino) &&
    typeof snapshot.size === "number" &&
    Number.isSafeInteger(snapshot.size) &&
    snapshot.size >= 0 &&
    typeof snapshot.mtimeMs === "number" &&
    Number.isFinite(snapshot.mtimeMs) &&
    typeof snapshot.ctimeMs === "number" &&
    Number.isFinite(snapshot.ctimeMs)
  );
}

function readClaimArtifact(
  projectDir: string,
  runDir: string,
): VerifiedBuilderTaskClaimArtifact | null {
  const artifact = readOptionalJsonFile<BuilderTaskClaimArtifact>(
    join(projectDir, runDir, "task-claim.json"),
  );
  if (artifact === null) return null;
  if (!isVerifiedClaimBinding(artifact)) {
    throw new Error(`Builder run claim artifact is malformed: ${runDir}/task-claim.json`);
  }
  return artifact;
}

function sameTaskFile(
  left: RepoTaskFileDescriptor,
  right: RepoTaskFileDescriptor,
): boolean {
  return left.path === right.path &&
    left.snapshot.dev === right.snapshot.dev &&
    left.snapshot.ino === right.snapshot.ino &&
    left.snapshot.size === right.snapshot.size &&
    left.snapshot.mtimeMs === right.snapshot.mtimeMs &&
    left.snapshot.ctimeMs === right.snapshot.ctimeMs;
}

function currentTaskMatchesClaim(
  current: RepoTaskFileDescriptor & { content: string },
  claim: TaskClaim,
): boolean {
  if (claim.taskContentDigest === undefined || claim.taskContractDigest === undefined) {
    return false;
  }
  if (current.path === claim.taskFile.path) {
    return taskClaimContentDigest(current.content) === claim.taskContentDigest &&
      current.snapshot.dev === claim.taskFile.snapshot.dev &&
      current.snapshot.ino === claim.taskFile.snapshot.ino;
  }
  return isCanonicalTaskContent(current.content) &&
    taskClaimContractDigest(current.content) === claim.taskContractDigest &&
    claim.taskState === "ready" &&
    current.path === join(REPO_TASKS_DIR, "doing", `${claim.taskId}.md`);
}

function readCurrentClaimedTask(projectDir: string, taskId: string) {
  for (const state of CLAIM_CANDIDATE_STATES) {
    const taskFile = readVerifiedRepoTaskFile(projectDir, state, taskId);
    if (taskFile !== null) return taskFile;
  }
  return null;
}

function assertAuthoritativeClaim(
  source: DecompositionSource,
  artifact: VerifiedBuilderTaskClaimArtifact,
  claim: TaskClaim | null,
): TaskClaim {
  if (claim === null) {
    throw new Error(
      `Cannot decompose ${artifact.taskId}: active pending-decomposition claim is missing`,
    );
  }
  if (
    claim.taskId !== artifact.taskId ||
    claim.runId !== source.runId ||
    claim.workflowId !== "builder" ||
    claim.status !== "pending-decomposition"
  ) {
    throw new Error(
      `Cannot decompose ${artifact.taskId}: claim ownership is ${claim.workflowId}/${claim.runId}/${claim.status}, expected builder/${source.runId}/pending-decomposition`,
    );
  }
  if (
    artifact.claim.runId !== claim.runId ||
    artifact.claim.workflowId !== claim.workflowId ||
    artifact.claim.taskState !== claim.taskState ||
    artifact.claim.taskContentDigest !== claim.taskContentDigest ||
    artifact.claim.taskContractDigest !== claim.taskContractDigest ||
    !sameTaskFile(artifact.claim.taskFile, claim.taskFile)
  ) {
    throw new Error(
      `Cannot decompose ${artifact.taskId}: run claim artifact does not match the authoritative task claim`,
    );
  }
  return claim;
}

export type OwnershipResolution =
  | { kind: "missing-artifact" }
  | { kind: "superseded-task"; reason: string }
  | {
      kind: "owned-task";
      task: { id: string; path: string; markdown: string };
    };

export function resolveDecompositionOwnership(
  projectDir: string,
  source: DecompositionSource,
): OwnershipResolution {
  const artifact = readClaimArtifact(projectDir, source.runDir);
  if (artifact === null) return { kind: "missing-artifact" };

  const claim = assertAuthoritativeClaim(
    source,
    artifact,
    readActiveTaskClaim(projectDir, artifact.taskId),
  );
  const taskFile = readCurrentClaimedTask(projectDir, claim.taskId);
  if (taskFile === null) {
    return {
      kind: "superseded-task",
      reason: `Builder task ${claim.taskId} is no longer in a claimable task state; current task state supersedes this failure`,
    };
  }
  if (!currentTaskMatchesClaim(taskFile, claim)) {
    return {
      kind: "superseded-task",
      reason: `Builder task ${claim.taskId} changed after the failed run claimed it; current task identity supersedes this failure`,
    };
  }
  return {
    kind: "owned-task",
    task: {
      id: claim.taskId,
      path: taskFile.path,
      markdown: taskFile.content,
    },
  };
}
