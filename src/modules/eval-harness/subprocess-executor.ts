import { randomUUID } from "node:crypto";
import { forceRemoveContainerReference } from "./isolated-container-process.js";

/**
 * Subprocess-backed workflow executor.
 *
 * Invokes `kota workflow exec <name>` inside the fixture's isolated working
 * directory. The subprocess boundary is the fixture isolation boundary and
 * the child process lifetime is the run lifetime. When the child exceeds the
 * fixture budget the executor kills it with SIGTERM and reports `timeout`.
 */

import { dirname, join, resolve } from "node:path";
import { type ProcessSpawnObserver, ProcessSupervisor } from "#core/execution/process-supervisor.js";
import { writeStderr } from "#modules/rendering/transport.js";
import { containerAuthIssue, snapshotContainerAuth } from "./container-auth.js";
import { resolveExecutableVerifierSandbox } from "./executable-verifier-sandbox.js";
import type { WorkflowExecutionOutcome, WorkflowExecutor } from "./runner.js";
import { resolveScientificClaimAnalyzerSandbox } from "./scientific-claim-analyzer-sandbox.js";
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
    predicateContext: {
      executableVerifierSandbox:
        resolveExecutableVerifierSandbox(isolationBackend),
      scientificClaimAnalyzerSandbox:
        resolveScientificClaimAnalyzerSandbox(isolationBackend),
    },
    preflight(requestedProfile) {
      const profile = preflightExecutionProfile(
        isolationBackend,
        requestedProfile,
        options.providerEgressTaskBoundary,
      );
      const issue = containerExecutionProfileCanRun(profile) && options.containerAuth !== undefined
        ? containerAuthIssue(options.containerAuth) : null;
      if (issue !== null) {
        return {
          ...profile, status: "non-gating", verification: "unverified", gateEligible: false,
          nonGatingReason: "isolation-backend-config-invalid",
          diagnostics: [...profile.diagnostics, { severity: "warning", message: issue }],
        };
      }
      return profile;
    },
    async execute(request: WorkflowExecutionRequest): Promise<WorkflowExecutionOutcome> {
      options.signal?.throwIfAborted();
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
          options.signal, options.onProcessSpawn, options.onExecutionFailure,
        );
      } finally {
        await childSpec.cleanup?.();
      }
    },
  };
}

function buildChildSpec(params: {
  options: SubprocessExecutorOptions;
  request: WorkflowExecutionRequest;
  hostKotaDistDir: string;
  hostExecArgs: string[];
  containerCommandArgs?: string[];
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

  const login = params.options.containerAuth === undefined ? undefined
    : snapshotContainerAuth(params.options.containerAuth, params.request.workingDir);
  let envFile: ReturnType<typeof writeContainerEnvFile> | undefined;
  try {
    const containerEnv = containerExecutionEnv(
      params.options,
      params.request,
      containerKotaDistDir(backend),
      params.request.executionProfile.networkPolicy,
    );
    const containerEnvFile = writeContainerEnvFile({ ...containerEnv, ...login?.env });
    envFile = containerEnvFile;
    const containerName = `kota-eval-${randomUUID()}`;
    const containerCliEnv = dockerCliEnv(params.request.executionProfile.networkPolicy);
    return {
      command: backend.executable,
      args: containerRunArgs({
        backend,
        containerName,
        executionProfile: params.request.executionProfile,
        workingDir: params.request.workingDir,
        envFilePath: containerEnvFile.path,
        authMount: login?.mount,
        command: "node",
        commandArgs: params.containerCommandArgs ?? workflowExecArgs(backend.kotaBinaryPath, params.request),
      }),
      cwd: params.request.workingDir,
      env: containerCliEnv,
      label: `container isolation backend "${backend.executable}"`,
      cleanup: async () => {
        try {
          const result = await forceRemoveContainerReference(backend.executable, containerName, containerCliEnv);
          if (result.error || (result.status !== 0 && !result.stderr?.includes("No such container"))) throw new Error(`Container cleanup failed: ${result.error?.message ?? result.stderr ?? result.status}`);
        } finally { containerEnvFile.cleanup(); login?.cleanup(); }
      },
    };
  } catch (error) { envFile?.cleanup(); login?.cleanup(); throw error; }
}

async function runChildAndReadOutcome(
  childSpec: SubprocessChildSpec,
  request: WorkflowExecutionRequest,
  existingWorkflowRunIds: ReadonlySet<string>,
  startMs: number,
  signal?: AbortSignal,
  onProcessSpawn?: ProcessSpawnObserver,
  onExecutionFailure?: (error: Error) => void,
): Promise<WorkflowExecutionOutcome> {
  const budget = new AbortController();
  let timedOut = false;
  const budgetTimer = setTimeout(() => {
    timedOut = true;
    budget.abort(new Error("Evaluation fixture budget exceeded"));
  }, request.budgetMs);
  let outcome: Awaited<ReturnType<ProcessSupervisor["run"]>>;
  try {
    outcome = await new ProcessSupervisor({
      command: childSpec.command, args: childSpec.args, cwd: childSpec.cwd, env: childSpec.env,
      captureLimitBytesPerStream: 64 * 1024, terminationGraceMs: 1000,
      signal: signal ? AbortSignal.any([signal, budget.signal]) : budget.signal,
      onSpawn: onProcessSpawn,
      onOutput: (event) => { if (event.stream === "stderr") writeStderr(event.data); },
    }).run();
  } finally { clearTimeout(budgetTimer); }
  const code = outcome.status === "spawn-failed" ? null : outcome.exitCode;
  const spawnError = outcome.status === "spawn-failed" ? outcome.error : null;
  signal?.throwIfAborted();

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
    onExecutionFailure?.(new Error(outcome.status === "spawn-failed" ? outcome.error.message : outcome.stderr.text));
    signal?.throwIfAborted();
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

/** Trusted runner composition: reuse candidate credentials, OCI policy and cleanup. */
export async function executeContainedCommand(
  options: SubprocessExecutorOptions,
  request: WorkflowExecutionRequest,
  commandArgs: string[],
) {
  options.signal?.throwIfAborted();
  if (options.isolationBackend?.kind !== "container") throw new Error("Contained commands require a container");
  const child = buildChildSpec({ options, request, isolationBackend: options.isolationBackend,
    hostKotaDistDir: "", hostExecArgs: [], containerCommandArgs: commandArgs });
  if (!child) throw new Error("Contained command preflight rejected; refusing host execution");
  try {
    const deadline = AbortSignal.timeout(request.budgetMs);
    const result = await new ProcessSupervisor({
      command: child.command, args: child.args, cwd: child.cwd, env: child.env,
      signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline,
      onSpawn: options.onProcessSpawn, captureLimitBytesPerStream: 32 * 1024 * 1024,
      terminationGraceMs: 1000,
    }).run();
    options.signal?.throwIfAborted();
    if (result.status === "spawn-failed") throw new Error(result.error.message);
    if (result.stdout.truncated || result.stderr.truncated) throw new Error("Contained command output was truncated");
    if (result.exitCode !== 0 || deadline.aborted) {
      const error = new Error(`Contained command failed: ${result.stderr.text || result.exitCode}`);
      options.onExecutionFailure?.(error);
      throw error;
    }
    return result;
  } finally { await child.cleanup?.(); }
}
