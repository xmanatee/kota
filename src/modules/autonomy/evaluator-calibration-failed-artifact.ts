import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type {
  KotaJsonObject,
  KotaJsonValue,
} from "#core/agent-harness/message-protocol.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type { WorkflowTerminalFinalizerInput } from "#core/workflow/types.js";
import { getCriticPromptHash } from "./critic.js";
import {
  deriveCalibrationReviewSignals,
  findCalibrationTaskFinalState,
  isCalibrationSourceFile,
  readCalibrationCriticVerdict,
} from "./evaluator-calibration-artifact.js";
import {
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
} from "./evaluator-calibration-types.js";

type FailedBuilderWorkspace = {
  workspaceDir: string;
  agentRunDir: string;
  taskId: string;
};

function isJsonObject(
  value: KotaJsonValue | undefined,
): value is KotaJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failedBuilderWorkspace(
  input: WorkflowTerminalFinalizerInput,
): FailedBuilderWorkspace | null {
  const buildStep = input.metadata.steps.find((step) => step.id === "build");
  if (input.metadata.status !== "failed" || buildStep?.status !== "failed") {
    return null;
  }
  const prepareStep = input.metadata.steps.find(
    (step) => step.id === "prepare-worktree",
  );
  const output = prepareStep?.output as KotaJsonValue | undefined;
  if (!isJsonObject(output)) {
    throw new Error("Failed builder calibration is missing prepare-worktree output");
  }
  const runtimeResources = output.runtimeResources;
  if (typeof output.workspaceDir !== "string") {
    throw new Error("Failed builder calibration is missing workspaceDir");
  }
  if (
    !isJsonObject(runtimeResources) ||
    typeof runtimeResources.agentRunDir !== "string"
  ) {
    throw new Error("Failed builder calibration is missing agentRunDir");
  }
  if (typeof output.taskId !== "string") {
    throw new Error("Failed builder calibration is missing taskId");
  }
  return {
    workspaceDir: output.workspaceDir,
    agentRunDir: runtimeResources.agentRunDir,
    taskId: output.taskId,
  };
}

function gitPathLines(workspaceDir: string, args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], {
    cwd: workspaceDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Failed to inspect builder workspace paths: ${result.stderr.trim() || `git exited ${result.status}`}`,
    );
  }
  const output = result.stdout.trim();
  return output ? output.split("\n") : [];
}

function changedWorkspacePaths(workspaceDir: string): string[] {
  return [
    ...new Set([
      ...gitPathLines(workspaceDir, ["diff", "--name-only", "HEAD", "--"]),
      ...gitPathLines(workspaceDir, ["ls-files", "--others", "--exclude-standard"]),
    ]),
  ].sort();
}

function workspaceSourceRevision(workspaceDir: string): string {
  const [revision] = gitPathLines(workspaceDir, ["rev-parse", "HEAD"]);
  if (!revision || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("Failed builder calibration could not resolve workspace HEAD");
  }
  return revision;
}

export type WriteFailedCalibrationArtifactOptions = {
  /** Deterministic prompt-hash override for tests. */
  criticPromptHash?: string;
};

/** Persist calibration for a failed build while its workspace is inspectable. */
export function writeFailedCalibrationArtifact(
  input: WorkflowTerminalFinalizerInput,
  options: WriteFailedCalibrationArtifactOptions = {},
): EvaluatorCalibrationArtifact | null {
  const workspace = failedBuilderWorkspace(input);
  if (workspace === null) return null;
  const buildStep = input.metadata.steps.find((step) => step.id === "build");
  if (buildStep === undefined) {
    throw new Error("Failed builder calibration is missing build step metadata");
  }
  const runDir = join(input.projectDir, input.metadata.runDir);
  const criticVerdict = readCalibrationCriticVerdict([
    workspace.agentRunDir,
    runDir,
  ]);
  const artifact: EvaluatorCalibrationArtifact = {
    runId: input.metadata.id,
    workflow: input.metadata.workflow,
    completedAt:
      input.metadata.completedAt ?? buildStep.completedAt ?? new Date().toISOString(),
    ...deriveCalibrationReviewSignals(buildStep.output, criticVerdict),
    terminalRunStatus: "failed",
    taskId: workspace.taskId,
    taskFinalState: findCalibrationTaskFinalState(
      workspace.workspaceDir,
      workspace.taskId,
    ),
    sourceRevision: workspaceSourceRevision(workspace.workspaceDir),
    sourceFilesChanged: changedWorkspacePaths(workspace.workspaceDir).filter(
      isCalibrationSourceFile,
    ),
    criticPromptHash:
      options.criticPromptHash ??
      criticVerdict?.reviewerPromptHash ??
      getCriticPromptHash(),
  };
  writeJsonFileAtomic(join(runDir, EVALUATOR_CALIBRATION_ARTIFACT), artifact);
  return artifact;
}
