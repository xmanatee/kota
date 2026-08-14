import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import {
  type BuilderDecompositionFailureKind,
  classifyBuilderFailureForDecomposition,
} from "#modules/autonomy/builder-failure-classification.js";
import { CLAIM_SCHEMA_VERSION } from "#modules/autonomy/task-claims.js";
import {
  REPO_TASK_STATES,
  REPO_TASKS_DIR,
  type RepoTaskFileDescriptor,
  type RepoTaskState,
  readVerifiedRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export type DecomposerAssessment = {
  reason: string;
  failedRunId: string;
  failedRunDir: string;
  failureKind: BuilderDecompositionFailureKind | null;
} & (
  | { shouldDecompose: false }
  | {
      shouldDecompose: true;
      taskId: string;
      taskPath: string;
      taskMarkdown: string;
    }
);

export type DecomposerAssessmentInput = {
  projectDir: string;
  triggerEvent: string;
  triggerPayload: WorkflowRunTrigger["payload"];
};

const TASK_STATES_FOR_IDENTIFIED_TASK = ["doing", "blocked", "ready"] as const;

function findTaskById(
  projectDir: string,
  taskId: string,
): { id: string; path: string; markdown: string } | null {
  for (const state of TASK_STATES_FOR_IDENTIFIED_TASK) {
    const taskFile = readVerifiedRepoTaskFile(projectDir, state, taskId);
    if (taskFile !== null) {
      return { id: taskId, path: taskFile.path, markdown: taskFile.content };
    }
  }
  return null;
}

type ResolvedSource = {
  runId: string;
  runDir: string;
  skip: boolean;
};

function resolveSourceRun(
  triggerEvent: string,
  payload: WorkflowRunTrigger["payload"],
): ResolvedSource {
  if (triggerEvent === "runtime.recovered") {
    const sourceWorkflow = payload.sourceWorkflow;
    if (sourceWorkflow !== "builder") {
      return { runId: "", runDir: "", skip: true };
    }
    const sourceRunId = payload.sourceRunId;
    if (typeof sourceRunId !== "string" || sourceRunId.length === 0) {
      throw new Error(
        "Decomposer recovery trigger payload must include sourceRunId when sourceWorkflow is builder",
      );
    }
    return {
      runId: sourceRunId,
      runDir: join(".kota", "runs", sourceRunId),
      skip: false,
    };
  }

  const runDir = payload.runDir;
  const runId = payload.runId;
  if (typeof runDir !== "string" || typeof runId !== "string") {
    throw new Error("Decomposer trigger payload must include runDir and runId");
  }
  return { runId, runDir, skip: false };
}

type BuilderTaskClaimArtifact = {
  claimed?: boolean;
  taskId?: string | null;
  claim?: {
    schemaVersion?: number;
    taskId?: string;
    taskState?: RepoTaskState;
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

function isVerifiedClaimBinding(
  artifact: BuilderTaskClaimArtifact,
): artifact is BuilderTaskClaimArtifact & {
  claimed: true;
  taskId: string;
  claim: {
    schemaVersion: typeof CLAIM_SCHEMA_VERSION;
    taskId: string;
    taskState: RepoTaskState;
    taskFile: RepoTaskFileDescriptor;
  };
} {
  const claim = artifact.claim;
  if (
    artifact.claimed !== true ||
    typeof artifact.taskId !== "string" ||
    claim === null ||
    claim === undefined ||
    claim.schemaVersion !== CLAIM_SCHEMA_VERSION ||
    claim.taskId !== artifact.taskId ||
    claim.taskState === undefined ||
    !REPO_TASK_STATES.includes(claim.taskState) ||
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

function readClaimedTaskId(projectDir: string, runDir: string): string | null {
  const artifact = readOptionalJsonFile<BuilderTaskClaimArtifact>(
    join(projectDir, runDir, "task-claim.json"),
  );
  return artifact !== null && isVerifiedClaimBinding(artifact)
    ? artifact.taskId
    : null;
}

export function assessDecomposerFailureInWorker(
  input: DecomposerAssessmentInput,
): DecomposerAssessment {
  const source = resolveSourceRun(input.triggerEvent, input.triggerPayload);

  if (source.skip) {
    return {
      shouldDecompose: false,
      reason: "Recovery source was not builder — nothing for decomposer to do",
      failedRunId: "",
      failedRunDir: "",
      failureKind: null,
    };
  }

  const metadataPath = join(input.projectDir, source.runDir, "metadata.json");
  const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);

  if (!metadata) {
    return {
      shouldDecompose: false,
      reason: `Could not read run metadata at ${metadataPath}`,
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      failureKind: null,
    };
  }

  const failureKind = classifyBuilderFailureForDecomposition(metadata);
  if (failureKind === null) {
    return {
      shouldDecompose: false,
      reason: "Builder failure does not require task rescoping",
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      failureKind: null,
    };
  }

  const candidateId = readClaimedTaskId(input.projectDir, source.runDir);
  const task = candidateId ? findTaskById(input.projectDir, candidateId) : null;

  if (!task) {
    return {
      shouldDecompose: false,
      reason: candidateId
        ? `Builder task ${candidateId} is no longer active; its current task state supersedes this failure`
        : "Builder run has no claimed task artifact to rescope",
      failedRunId: source.runId,
      failedRunDir: source.runDir,
      failureKind,
    };
  }

  return {
    shouldDecompose: true,
    reason: `Builder ${failureKind === "timeout" ? "timed out" : "exhausted repair"} on ${task.id} — rescoping`,
    failedRunId: source.runId,
    failedRunDir: source.runDir,
    taskId: task.id,
    taskPath: task.path,
    taskMarkdown: task.markdown,
    failureKind,
  };
}
