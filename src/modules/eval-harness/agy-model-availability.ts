import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEffort } from "#core/agent-harness/index.js";
import {
  AGY_MODEL_EVALUATION_EFFORT,
  AGY_MODEL_EVALUATION_NATIVE_EFFORT,
  type AgyModelAvailabilityEvidence,
} from "./agy-model-evaluation-types.js";
import type { EvalRunExecution } from "./eval-run-execution.js";
import type { WorkflowExecutionRequest } from "./runner.js";
import {
  containerKotaDistDir,
  containerRunArgs,
} from "./subprocess-executor-command.js";
import {
  containerExecutionEnv,
  dockerCliEnv,
  writeContainerEnvFile,
} from "./subprocess-executor-env.js";
import { containerExecutionProfileCanRun } from "./subprocess-executor-preflight.js";
import type { SubprocessExecutorOptions } from "./subprocess-executor-types.js";

const AGY_MODEL_TOKEN = /\bgemini-[A-Za-z0-9][A-Za-z0-9._-]*/g;

export type AgyModelsCommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  runtimeDetail: string;
  errorMessage?: string;
};

export type AgyModelsCommandRunner = (
  execution: EvalRunExecution,
) => AgyModelsCommandResult;

export type AgyModelAvailabilityProbe =
  | { ok: true; evidence: AgyModelAvailabilityEvidence }
  | {
      ok: false;
      reason: "availability_probe_failed" | "candidate_unavailable";
      message: string;
      evidence: AgyModelAvailabilityEvidence;
    };

export function parseAgyAvailableModels(output: string): string[] {
  return [...new Set(output.match(AGY_MODEL_TOKEN) ?? [])].sort();
}

function requestedAgyCatalogModel(model: string): string {
  const effortSuffix = `-${AGY_MODEL_EVALUATION_NATIVE_EFFORT}`;
  return model.endsWith(effortSuffix) ? model : `${model}${effortSuffix}`;
}

export function runAgyModelsCommand(
  execution: EvalRunExecution,
): AgyModelsCommandResult {
  const backend = execution.isolationBackend;
  if (backend.kind !== "container") {
    return {
      status: null,
      stdout: "",
      stderr: "",
      runtimeDetail: "configured eval execution",
      errorMessage:
        "AGY availability must run in the configured candidate container; host execution is forbidden.",
    };
  }
  const executionProfile = execution.executor.preflight(
    execution.requestedProfile,
  );
  const runtimeDetail =
    `container image ${JSON.stringify(backend.image)} via ` +
    `${JSON.stringify(backend.executable)}`;
  if (!containerExecutionProfileCanRun(executionProfile)) {
    const diagnostics = executionProfile.diagnostics
      .map((diagnostic) => diagnostic.message)
      .join("; ");
    return {
      status: null,
      stdout: "",
      stderr: "",
      runtimeDetail,
      errorMessage:
        `Configured candidate ${runtimeDetail} did not pass execution preflight` +
        (diagnostics.length > 0 ? `: ${diagnostics}` : "."),
    };
  }

  const workingDir = mkdtempSync(join(tmpdir(), "kota-agy-model-availability-"));
  const request: WorkflowExecutionRequest = {
    workflowName: "agy-model-availability",
    workingDir,
    budgetMs: 30_000,
    executionProfile,
  };
  const executorOptions: SubprocessExecutorOptions = {
    kotaBinaryPath: backend.kotaBinaryPath,
    isolationBackend: backend,
    extraEnv: execution.executorEnv,
  };
  const containerEnv = containerExecutionEnv(
    executorOptions,
    request,
    containerKotaDistDir(backend),
    executionProfile.networkPolicy,
  );
  const envFile = writeContainerEnvFile(containerEnv);
  try {
    const result = spawnSync(
      backend.executable,
      containerRunArgs({
        backend,
        executionProfile,
        workingDir,
        envFilePath: envFile.path,
        command: "agy",
        commandArgs: ["models"],
      }),
      {
        cwd: workingDir,
        encoding: "utf8",
        env: dockerCliEnv(executionProfile.networkPolicy),
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      },
    );
    return {
      status: result.status,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
      runtimeDetail,
      ...(result.error !== undefined && { errorMessage: result.error.message }),
    };
  } finally {
    envFile.cleanup();
    rmSync(workingDir, { recursive: true, force: true });
  }
}

export function probeAgyModelAvailability(
  requestedModels: readonly string[],
  execution: EvalRunExecution,
  runCommand: AgyModelsCommandRunner = runAgyModelsCommand,
): AgyModelAvailabilityProbe {
  const commandResult = runCommand(execution);
  const availableModels = parseAgyAvailableModels(
    [commandResult.stdout, commandResult.stderr].join("\n"),
  );
  const requestedCatalogModels = requestedModels.map(requestedAgyCatalogModel);
  const unavailable = requestedCatalogModels.filter(
    (model) => !availableModels.includes(model),
  );
  const commandDetail = [
    commandResult.errorMessage,
    commandResult.stderr.trim(),
  ].filter((value): value is string => value !== undefined && value.length > 0);
  if (commandResult.status !== 0 || commandResult.errorMessage !== undefined) {
    const detail =
      commandDetail.join("; ") ||
      `agy models exited with status ${String(commandResult.status)}`;
    return {
      ok: false,
      reason: "availability_probe_failed",
      message: `Cannot verify requested AGY candidates: ${detail}`,
      evidence: {
        command: "agy models",
        availableModels,
        requestedModels,
        requestedCatalogModels,
        nativeEffort: AGY_MODEL_EVALUATION_NATIVE_EFFORT,
        passed: false,
        detail: `${detail} (${commandResult.runtimeDetail})`,
      },
    };
  }
  if (unavailable.length > 0) {
    const detail =
      `Requested AGY candidate(s) unavailable: ${unavailable.join(", ")}. ` +
      `Available in ${commandResult.runtimeDetail}: ` +
      `${availableModels.join(", ") || "(none)"}.`;
    return {
      ok: false,
      reason: "candidate_unavailable",
      message: detail,
      evidence: {
        command: "agy models",
        availableModels,
        requestedModels,
        requestedCatalogModels,
        nativeEffort: AGY_MODEL_EVALUATION_NATIVE_EFFORT,
        passed: false,
        detail,
      },
    };
  }
  return {
    ok: true,
    evidence: {
      command: "agy models",
      availableModels,
      requestedModels,
      requestedCatalogModels,
      nativeEffort: AGY_MODEL_EVALUATION_NATIVE_EFFORT,
      passed: true,
      detail:
        `All ${requestedModels.length} requested AGY candidate/high-effort ` +
        `combination(s) are available ` +
        `in ${commandResult.runtimeDetail}.`,
    },
  };
}

export function validateAgyEvaluationEffort(
  effort: AgentEffort | undefined,
):
  | { ok: true; effort: typeof AGY_MODEL_EVALUATION_EFFORT }
  | { ok: false; message: string } {
  const requested = effort ?? AGY_MODEL_EVALUATION_EFFORT;
  if (requested !== AGY_MODEL_EVALUATION_EFFORT) {
    return {
      ok: false,
      message:
        `AGY model evaluation requires effort "${AGY_MODEL_EVALUATION_EFFORT}" ` +
        `(the adapter maps it to AGY "high"); requested "${requested}".`,
    };
  }
  return { ok: true, effort: AGY_MODEL_EVALUATION_EFFORT };
}
