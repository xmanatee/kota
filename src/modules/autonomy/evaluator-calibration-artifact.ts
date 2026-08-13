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
  REPO_TASKS_DIR,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { type CriticVerdict, getCriticPromptHash } from "./critic.js";
import {
  CRITIC_CHECK_ID,
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationArtifact,
  type EvaluatorCalibrationVerdict,
} from "./evaluator-calibration-types.js";

export type CalibrationCriticVerdict = CriticVerdict & {
  /** Prompt identity captured when the critic made this verdict. */
  reviewerPromptHash: string | null;
};

export function readCalibrationCriticVerdict(
  runDirs: readonly string[],
): CalibrationCriticVerdict | null {
  for (const runDir of new Set(runDirs)) {
    const path = join(runDir, "critic-review.json");
    if (!existsSync(path)) continue;
    const parsed = readOptionalJsonFile<KotaJsonValue>(path);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Invalid critic verdict payload in ${path}`);
    }
    if (
      parsed.verdict !== "pass" &&
      parsed.verdict !== "pass_with_warnings" &&
      parsed.verdict !== "fail"
    ) {
      throw new Error(`Invalid critic verdict in ${path}: ${String(parsed.verdict)}`);
    }
    if (
      !Array.isArray(parsed.critical_issues) ||
      !parsed.critical_issues.every((issue) => typeof issue === "string") ||
      !Array.isArray(parsed.warnings) ||
      !parsed.warnings.every((warning) => typeof warning === "string") ||
      typeof parsed.summary !== "string"
    ) {
      throw new Error(`Invalid critic verdict payload in ${path}`);
    }
    if (
      parsed.reviewerPromptHash !== undefined &&
      typeof parsed.reviewerPromptHash !== "string"
    ) {
      throw new Error(`Invalid critic reviewerPromptHash in ${path}`);
    }
    return {
      verdict: parsed.verdict,
      critical_issues: parsed.critical_issues,
      warnings: parsed.warnings,
      summary: parsed.summary,
      reviewerPromptHash: parsed.reviewerPromptHash ?? null,
    };
  }
  return null;
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

type FindTaskFinalState = (
  projectDir: string,
  taskId: string,
) => RepoTaskState | null;

export function findCalibrationTaskFinalState(
  projectDir: string,
  taskId: string,
): RepoTaskState | null {
  const states: RepoTaskState[] = [
    "done",
    "dropped",
    "blocked",
    "doing",
    "ready",
    "backlog",
  ];
  for (const state of states) {
    const candidate = join(projectDir, TASK_PATH_PREFIX, state, `${taskId}.md`);
    if (existsSync(candidate)) return state;
  }
  return null;
}

export type WriteCalibrationArtifactOptions = {
  agentStepId?: string;
  findTaskFinalState?: FindTaskFinalState;
  /** Workspace-local directory where the critic wrote its final verdict. */
  criticVerdictRunDir?: string;
  /** Deterministic prompt-hash override for tests. */
  criticPromptHash?: string;
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

export function deriveCalibrationReviewSignals(
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

/** Compose and persist the calibration artifact after a builder commit. */
export function writeCalibrationArtifact(
  ctx: WorkflowStepContext,
  options: WriteCalibrationArtifactOptions = {},
): EvaluatorCalibrationArtifact {
  const agentStepId = options.agentStepId ?? "build";
  const findTaskFinalState = options.findTaskFinalState ?? findCalibrationTaskFinalState;
  const runDir = ctx.workflow.runDirPath;
  const runSummary = readOptionalJsonFile<{
    runId: string;
    workflow: string;
    taskId: string | null;
    commitSha: string;
    filesChanged: string[];
    completedAt: string;
  }>(join(runDir, "run-summary.json"));

  const criticVerdict = readCalibrationCriticVerdict([
    ...(options.criticVerdictRunDir ? [options.criticVerdictRunDir] : []),
    runDir,
  ]);
  const reviewSignals = deriveCalibrationReviewSignals(
    ctx.stepOutputs[agentStepId],
    criticVerdict,
  );

  // This writer runs only after the builder commit. A failed build is gated
  // before this point; anything else is still in progress.
  const terminalRunStatus: WorkflowRunStatus | "running" =
    ctx.stepResults[agentStepId]?.status === "success" ? "success" : "running";
  const taskId = runSummary?.taskId ?? null;
  const artifact: EvaluatorCalibrationArtifact = {
    runId: ctx.workflow.runId,
    workflow: ctx.workflow.name,
    completedAt: runSummary?.completedAt ?? new Date().toISOString(),
    ...reviewSignals,
    terminalRunStatus,
    taskId,
    taskFinalState: taskId
      ? findTaskFinalState(ctx.projectDir, taskId)
      : null,
    sourceRevision: runSummary?.commitSha ?? null,
    sourceFilesChanged: (runSummary?.filesChanged ?? []).filter(
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
