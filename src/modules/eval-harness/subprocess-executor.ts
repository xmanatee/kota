/**
 * Subprocess-backed workflow executor.
 *
 * Invokes `kota workflow exec <name>` inside the fixture's isolated working
 * directory. The subprocess boundary is the fixture isolation boundary and
 * the child process lifetime is the run lifetime. When the child exceeds the
 * fixture budget the executor kills it with SIGTERM and reports `timeout`.
 */

import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { writeStderr } from "#modules/rendering/transport.js";
import type { WorkflowExecutionOutcome, WorkflowExecutor } from "./runner.js";
import {
  containerKotaDistDir,
  containerRunArgs,
  workflowExecArgs,
} from "./subprocess-executor-command.js";
import {
  containerExecutionEnv,
  dockerCliEnv,
  hostExecutionEnv,
  writeContainerEnvFile,
} from "./subprocess-executor-env.js";
import {
  containerExecutionProfileCanRun,
  preflightExecutionProfile,
} from "./subprocess-executor-preflight.js";

export { detectHostSubprocessResourceProfile } from "./subprocess-executor-resource.js";

import {
  readTerminalRunForWorkflow,
  readWorkflowRunsForWorkflow,
} from "./subprocess-executor-runs.js";
import type {
  SubprocessChildSpec,
  SubprocessExecutorOptions,
} from "./subprocess-executor-types.js";

export type {
  SubprocessExecutorOptions,
  SubprocessIsolationBackend,
} from "./subprocess-executor-types.js";

import type { WorkflowExecutionRequest } from "./runner.js";

/**
 * Build a production-grade subprocess executor. Designed for the cadence
 * workflow and the CLI to use. Unit tests do not use this - they inject
 * lightweight in-process executors to avoid shell and network I/O.
 */
export function createSubprocessExecutor(
  options: SubprocessExecutorOptions,
): WorkflowExecutor {
  const isolationBackend = options.isolationBackend ?? { kind: "host-subprocess" };
  return {
    preflight(requestedProfile) {
      return preflightExecutionProfile(
        isolationBackend,
        requestedProfile,
        options.providerEgressTaskBoundary,
      );
    },
    async execute(request: WorkflowExecutionRequest): Promise<WorkflowExecutionOutcome> {
      const startMs = Date.now();
      const hostKotaRoot = dirname(dirname(resolve(options.kotaBinaryPath)));
      const hostKotaDistDir = join(hostKotaRoot, "dist");
      const hostExecArgs = workflowExecArgs(options.kotaBinaryPath, request);
      const existingWorkflowRunIds = new Set(
        readWorkflowRunsForWorkflow(request.workingDir, request.workflowName).map(
          (run) => run.id,
        ),
      );

      const childSpec = buildChildSpec({
        options,
        request,
        hostKotaDistDir,
        hostExecArgs,
        isolationBackend,
      });
      if (childSpec === null) {
        return {
          kind: "error",
          durationMs: Date.now() - startMs,
          message:
            "Container isolation execution requires a verified container preflight; refusing to downgrade to host subprocess execution.",
          runArtifactPath: null,
        };
      }

      try {
        return await runChildAndReadOutcome(
          childSpec,
          request,
          existingWorkflowRunIds,
          startMs,
        );
      } finally {
        childSpec.cleanup?.();
      }
    },
  };
}

function buildChildSpec(params: {
  options: SubprocessExecutorOptions;
  request: WorkflowExecutionRequest;
  hostKotaDistDir: string;
  hostExecArgs: string[];
  isolationBackend: SubprocessExecutorOptions["isolationBackend"];
}): SubprocessChildSpec | null {
  const backend = params.isolationBackend ?? { kind: "host-subprocess" };
  if (backend.kind === "host-subprocess") {
    return {
      command: "node",
      args: params.hostExecArgs,
      cwd: params.request.workingDir,
      env: hostExecutionEnv(
        params.options,
        params.request,
        params.hostKotaDistDir,
      ),
      label: "kota workflow exec",
    };
  }
  if (!containerExecutionProfileCanRun(params.request.executionProfile)) {
    return null;
  }

  const containerEnv = containerExecutionEnv(
    params.options,
    params.request,
    containerKotaDistDir(backend),
    params.request.executionProfile.networkPolicy,
  );
  const containerEnvFile = writeContainerEnvFile(containerEnv);
  return {
    command: backend.executable,
    args: containerRunArgs({
      backend,
      executionProfile: params.request.executionProfile,
      workingDir: params.request.workingDir,
      replayRecordingsRoot: params.request.replayRecordingsRoot,
      envFilePath: containerEnvFile.path,
      execArgs: workflowExecArgs(backend.kotaBinaryPath, params.request),
    }),
    cwd: params.request.workingDir,
    env: dockerCliEnv(params.request.executionProfile.networkPolicy),
    label: `container isolation backend "${backend.executable}"`,
    cleanup: containerEnvFile.cleanup,
  };
}

async function runChildAndReadOutcome(
  childSpec: SubprocessChildSpec,
  request: WorkflowExecutionRequest,
  existingWorkflowRunIds: ReadonlySet<string>,
  startMs: number,
): Promise<WorkflowExecutionOutcome> {
  const child = spawn(childSpec.command, childSpec.args, {
    cwd: childSpec.cwd,
    env: childSpec.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.resume();
  child.stderr.on("data", (chunk) => {
    writeStderr(String(chunk));
  });

  let timedOut = false;
  const budgetTimer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, request.budgetMs);

  const { code, spawnError } = await new Promise<{
    code: number | null;
    spawnError: Error | null;
  }>((resolve) => {
    child.on("exit", (exitCode) => resolve({ code: exitCode, spawnError: null }));
    child.on("error", (err) => resolve({ code: null, spawnError: err }));
  });
  clearTimeout(budgetTimer);

  const durationMs = Date.now() - startMs;
  if (timedOut) {
    return { kind: "timeout", durationMs, runArtifactPath: null };
  }
  if (spawnError) {
    return {
      kind: "error",
      durationMs,
      message: `Failed to spawn ${childSpec.label}: ${spawnError.message}`,
      runArtifactPath: null,
    };
  }

  const terminal = readTerminalRunForWorkflow(
    request.workingDir,
    request.workflowName,
    existingWorkflowRunIds,
  );
  const runArtifactPath = terminal
    ? join(request.workingDir, ".kota", "runs", terminal.id)
    : null;

  if (code !== 0) {
    return {
      kind: "error",
      durationMs,
      message: terminal
        ? `${childSpec.label} exited with status ${code}; run ${terminal.id} terminal status: ${terminal.status}.`
        : `${childSpec.label} exited with status ${code}; no terminal run produced.`,
      runArtifactPath,
    };
  }

  if (!terminal) {
    return {
      kind: "error",
      durationMs,
      message:
        "kota workflow exec exited cleanly but produced no terminal run artifact.",
      runArtifactPath: null,
    };
  }

  return { kind: "completed", durationMs, runArtifactPath };
}
