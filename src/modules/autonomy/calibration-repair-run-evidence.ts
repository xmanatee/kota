import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  KotaJsonObject,
  KotaJsonValue,
} from "#core/agent-harness/message-protocol.js";
import type { RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  EVALUATOR_CALIBRATION_ARTIFACT,
  EVALUATOR_CALIBRATION_STEP_ID,
  type EvaluatorCalibrationArtifact,
} from "./evaluator-calibration.js";

function isJsonObject(
  value: KotaJsonValue | undefined,
): value is KotaJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(
  value: KotaJsonValue | undefined,
): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isNonNegativeInteger(value: KotaJsonValue | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRepoTaskState(value: KotaJsonValue | undefined): value is RepoTaskState {
  return (
    value === "backlog" ||
    value === "ready" ||
    value === "doing" ||
    value === "blocked" ||
    value === "done" ||
    value === "dropped"
  );
}

function readRegularJsonObject(path: string): KotaJsonObject | null {
  const before = lstatSync(path, { throwIfNoEntry: false });
  if (
    before === undefined ||
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !== 1 ||
    !Number.isInteger(constants.O_NOFOLLOW) ||
    constants.O_NOFOLLOW === 0
  ) {
    return null;
  }

  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    return null;
  }

  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      return null;
    }
    const parsed: KotaJsonValue = JSON.parse(readFileSync(descriptor, "utf8"));
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  } finally {
    closeSync(descriptor);
  }
}

function parseCalibrationArtifact(
  value: KotaJsonObject,
): EvaluatorCalibrationArtifact | null {
  if (
    typeof value.runId !== "string" ||
    typeof value.workflow !== "string" ||
    typeof value.completedAt !== "string" ||
    !Number.isFinite(Date.parse(value.completedAt)) ||
    (value.verdict !== "pass" &&
      value.verdict !== "pass_with_warnings" &&
      value.verdict !== "fail" &&
      value.verdict !== "absent") ||
    !isNonNegativeInteger(value.warningCount) ||
    !isNonNegativeInteger(value.criticalIssueCount) ||
    !isNonNegativeInteger(value.repairIterations) ||
    !isStringArray(value.finalIterationFailures) ||
    !isNonNegativeInteger(value.criticFailureCount) ||
    (value.terminalRunStatus !== "success" &&
      value.terminalRunStatus !== "failed" &&
      value.terminalRunStatus !== "interrupted" &&
      value.terminalRunStatus !== "completed-with-warnings" &&
      value.terminalRunStatus !== "running") ||
    (value.taskId !== null && typeof value.taskId !== "string") ||
    (value.taskFinalState !== null && !isRepoTaskState(value.taskFinalState)) ||
    (value.sourceRevision !== null && typeof value.sourceRevision !== "string") ||
    !isStringArray(value.sourceFilesChanged) ||
    typeof value.criticPromptHash !== "string" ||
    value.criticPromptHash.length === 0
  ) {
    return null;
  }

  return {
    runId: value.runId,
    workflow: value.workflow,
    completedAt: value.completedAt,
    verdict: value.verdict,
    warningCount: value.warningCount,
    criticalIssueCount: value.criticalIssueCount,
    repairIterations: value.repairIterations,
    finalIterationFailures: value.finalIterationFailures,
    criticFailureCount: value.criticFailureCount,
    terminalRunStatus: value.terminalRunStatus,
    taskId: value.taskId,
    taskFinalState: value.taskFinalState,
    sourceRevision: value.sourceRevision,
    sourceFilesChanged: value.sourceFilesChanged,
    criticPromptHash: value.criticPromptHash,
  };
}

/** Read only a final builder artifact emitted by the canonical runtime code step. */
export function readBoundCalibrationArtifact(
  runsDir: string,
  directoryName: string,
): EvaluatorCalibrationArtifact | null {
  const runDir = join(runsDir, directoryName);
  const runStats = lstatSync(runDir, { throwIfNoEntry: false });
  if (
    runStats === undefined ||
    runStats.isSymbolicLink() ||
    !runStats.isDirectory()
  ) {
    return null;
  }

  const metadata = readRegularJsonObject(join(runDir, "metadata.json"));
  if (
    metadata === null ||
    metadata.id !== directoryName ||
    metadata.workflow !== "builder" ||
    metadata.runDir !== join(".kota", "runs", directoryName) ||
    (metadata.status !== "success" &&
      metadata.status !== "completed-with-warnings") ||
    typeof metadata.completedAt !== "string" ||
    !Number.isFinite(Date.parse(metadata.completedAt)) ||
    !Array.isArray(metadata.steps)
  ) {
    return null;
  }

  const calibrationSteps = metadata.steps.filter(
    (step) => isJsonObject(step) && step.id === EVALUATOR_CALIBRATION_STEP_ID,
  );
  if (calibrationSteps.length !== 1) return null;
  const calibrationStep = calibrationSteps[0];
  if (
    !isJsonObject(calibrationStep) ||
    calibrationStep.type !== "code" ||
    calibrationStep.status !== "success" ||
    typeof calibrationStep.startedAt !== "string" ||
    !Number.isFinite(Date.parse(calibrationStep.startedAt)) ||
    typeof calibrationStep.completedAt !== "string" ||
    !Number.isFinite(Date.parse(calibrationStep.completedAt)) ||
    typeof calibrationStep.durationMs !== "number" ||
    !Number.isFinite(calibrationStep.durationMs) ||
    calibrationStep.durationMs < 0 ||
    !isJsonObject(calibrationStep.output)
  ) {
    return null;
  }

  const stepRecord = readRegularJsonObject(
    join(runDir, "steps", `${EVALUATOR_CALIBRATION_STEP_ID}.json`),
  );
  const artifactRecord = readRegularJsonObject(
    join(runDir, EVALUATOR_CALIBRATION_ARTIFACT),
  );
  if (
    stepRecord === null ||
    artifactRecord === null ||
    !isDeepStrictEqual(stepRecord, calibrationStep) ||
    !isDeepStrictEqual(artifactRecord, calibrationStep.output)
  ) {
    return null;
  }

  const artifact = parseCalibrationArtifact(artifactRecord);
  if (
    artifact === null ||
    artifact.runId !== directoryName ||
    artifact.workflow !== "builder" ||
    artifact.terminalRunStatus !== "success" ||
    Date.parse(artifact.completedAt) > Date.parse(metadata.completedAt)
  ) {
    return null;
  }
  return artifact;
}
