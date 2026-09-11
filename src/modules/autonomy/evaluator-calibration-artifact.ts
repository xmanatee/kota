import { existsSync } from "node:fs";
import { join } from "node:path";
import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import { readRepairIterations } from "#core/workflow/repair-iteration-output.js";
import type {
  WorkflowRunStatus,
  WorkflowStepContext,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import {
  listFullRepoTasks,
  REPO_TASKS_DIR,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { type CriticVerdict, getCriticPromptHash } from "./critic.js";
import { CRITIC_REVIEW_ARTIFACT, decodeCriticVerdict } from "./critic-verdict.js";
import {
  CRITIC_CHECK_ID,
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
  type EvaluatorCalibrationVerdict,
} from "./evaluator-calibration-types.js";
import { readBuilderTaskPayload } from "./workflows/builder/task-contract.js";

type CalibrationCriticVerdict = CriticVerdict & {
  /** Prompt identity captured when the critic made this verdict. */
  reviewerPromptHash: string | null;
};

function readCalibrationCriticVerdict(
  runDir: string,
): CalibrationCriticVerdict | null {
  const path = join(runDir, CRITIC_REVIEW_ARTIFACT);
  if (!existsSync(path)) return null;
  const parsed = readOptionalJsonFile<KotaJsonValue>(path);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid critic verdict payload in ${path}`);
  }
  const verdict = decodeCriticVerdict(parsed);
  if (
    parsed.reviewerPromptHash !== undefined &&
    typeof parsed.reviewerPromptHash !== "string"
  ) {
    throw new Error(`Invalid critic reviewerPromptHash in ${path}`);
  }
  return {
    ...verdict,
    reviewerPromptHash: parsed.reviewerPromptHash ?? null,
  };
}

const AGENTS_BOOKKEEPING_SUFFIX = "AGENTS.md";
const TASK_PATH_PREFIX = `${REPO_TASKS_DIR}/`;
const RUNTIME_PATH_PREFIX = ".kota/";

export function isCalibrationSourceFile(path: string): boolean {
  return (
    !path.endsWith(AGENTS_BOOKKEEPING_SUFFIX) &&
    !path.startsWith(TASK_PATH_PREFIX) &&
    !path.startsWith(RUNTIME_PATH_PREFIX)
  );
}

export type WriteCalibrationArtifactOptions = {
  /** Workspace-local directory where the critic wrote its final verdict. */
  criticVerdictRunDir: string;
  agentStepId?: string;
};

type CalibrationReviewSignals = Pick<
  EvaluatorCalibrationArtifact,
  | "verdict"
  | "warningCount"
  | "criticalIssueCount"
  | "repairIterations"
  | "finalIterationFailures"
  | "criticFailureCount"
>;

function deriveCalibrationReviewSignals(
  buildOutput: WorkflowStepResult["output"],
  criticVerdict: CriticVerdict | null,
): CalibrationReviewSignals {
  const verdict: EvaluatorCalibrationVerdict = criticVerdict?.verdict ?? "absent";
  const warningCount = criticVerdict?.warnings.length ?? 0;
  const criticalIssueCount = criticVerdict?.critical_issues.length ?? 0;
  const iterations = readRepairIterations(buildOutput);
  const lastIterationFailures =
    iterations.at(-1)?.failures.map((failure) => failure.id) ?? [];
  const finalIterationFailures = lastIterationFailures.filter(
    (id) =>
      id !== CRITIC_CHECK_ID ||
      criticVerdict === null ||
      verdict === "fail" ||
      criticalIssueCount > 0,
  );
  const criticFailureCount = iterations.reduce(
    (count, iteration) =>
      iteration.failures.some((failure) => failure.id === CRITIC_CHECK_ID)
        ? count + 1
        : count,
    0,
  );
  return {
    verdict,
    warningCount,
    criticalIssueCount,
    repairIterations: iterations.length,
    finalIterationFailures,
    criticFailureCount,
  };
}

/** Persist review signals before runtime-owned writer integration. */
export function writeCalibrationArtifact(
  ctx: Pick<WorkflowStepContext,
    "workspaceRoot" | "scopeRoot" | "workflow" | "trigger" | "stepOutputs" | "stepResults"
  >,
  options: WriteCalibrationArtifactOptions,
): EvaluatorCalibrationArtifact {
  const agentStepId = options.agentStepId ?? "build";
  const runDir = ctx.workflow.runDirPath;

  const criticVerdict = readCalibrationCriticVerdict(
    options.criticVerdictRunDir,
  );
  const reviewSignals = deriveCalibrationReviewSignals(
    ctx.stepOutputs[agentStepId],
    criticVerdict,
  );

  // A failed build is gated before this point. Git outcome is joined from the
  // runtime-owned writer integration evidence by the aggregate reader.
  const terminalRunStatus: WorkflowRunStatus | "running" =
    ctx.stepResults[agentStepId]?.status === "success" ? "success" : "running";
  const taskId = ctx.workflow.name === "builder"
    ? readBuilderTaskPayload(ctx.trigger.payload).taskId
    : typeof ctx.trigger.payload.taskId === "string"
      ? ctx.trigger.payload.taskId
      : null;
  const artifact: EvaluatorCalibrationArtifact = {
    runId: ctx.workflow.runId,
    workflow: ctx.workflow.name,
    completedAt: new Date().toISOString(),
    ...reviewSignals,
    terminalRunStatus,
    taskId,
    taskFinalState: taskId
      ? listFullRepoTasks(ctx.workspaceRoot).find((task) => task.id === taskId)?.state ?? null
      : null,
    sourceRevision: null,
    sourceFilesChanged: [],
    criticPromptHash:
      criticVerdict?.reviewerPromptHash ??
      getCriticPromptHash(ctx.scopeRoot),
  };

  writeJsonFileAtomic(join(runDir, EVALUATOR_CALIBRATION_ARTIFACT), artifact);
  return artifact;
}
