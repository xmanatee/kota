/**
 * Subprocess-backed workflow executor.
 *
 * Invokes `kota workflow exec <name>` inside the fixture's isolated working
 * directory. The exec command runs the full workflow synchronously without a
 * daemon and exits only when the run reaches a terminal status, so the
 * subprocess boundary is the fixture isolation boundary and the child process
 * lifetime is the run lifetime. When the child exceeds the fixture budget the
 * executor kills it with SIGTERM and reports `timeout`.
 *
 * Fixture authors prepare the minimal KOTA project setup the targeted
 * workflow needs (e.g. seeded `data/` queue) in `initial/`. The executor
 * remaps `HOME` and `KOTA_PROJECT_DIR` to the working directory so
 * credential-driven side effects cannot leak from the operator's real
 * environment.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import { resourceProfilesComparable } from "./fixture-run.js";
import { REPLAY_AGENT_HARNESS_NAME_ENV } from "./replay-harness.js";
import type {
  WorkflowExecutionOutcome,
  WorkflowExecutionRequest,
  WorkflowExecutor,
} from "./runner.js";

export type SubprocessExecutorOptions = {
  /** Path to the `kota` binary (`./bin/kota.mjs` when running from the repo). */
  kotaBinaryPath: string;
  /**
   * Extra env vars to forward to the subprocess. The fixture's HOME is
   * deliberately pointed at the working directory so credential-driven side
   * effects cannot leak from the operator's real environment.
   */
  extraEnv?: Record<string, string>;
  /**
   * Optional isolation backend request. Host subprocess execution is the
   * default and is explicitly non-gating because it cannot enforce CPU or
   * memory limits. Container support is capability-detected before any run;
   * an unavailable backend produces a typed non-gating preflight result.
   */
  isolationBackend?: SubprocessIsolationBackend;
};

export type SubprocessIsolationBackend =
  | { kind: "host-subprocess" }
  | {
      kind: "container";
      /** Docker-compatible executable, for example `docker` or `podman`. */
      executable: string;
      /** Container image that contains Node and can run the KOTA CLI. */
      image: string;
      /**
       * Absolute path inside the container image to KOTA's `bin/kota.mjs`.
       * The image must preserve the package layout so `../dist` exists.
       */
      kotaBinaryPath: string;
    };

type RunMetadataSnapshot = {
  id: string;
  status: string;
};

type WorkflowRunMetadataSnapshot = RunMetadataSnapshot & {
  terminal: boolean;
};

const REPLAY_PRESET_ID = "claude";
const CONTAINER_DEFAULT_PATH =
  "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

export function detectHostSubprocessResourceProfile(
  hostClass: string,
): ResourceProfile {
  const cpuCores = Math.max(1, availableParallelism());
  const memoryMB = Math.max(1, Math.floor(totalmem() / (1024 * 1024)));
  return {
    hostClass,
    cpuAllocationCores: cpuCores,
    cpuKillThresholdCores: cpuCores,
    memoryAllocationMB: memoryMB,
    memoryKillThresholdMB: memoryMB,
  };
}

function diagnosticText(result: ReturnType<typeof spawnSync>): string {
  const parts = [
    result.error?.message,
    typeof result.stdout === "string" ? result.stdout.trim() : "",
    typeof result.stderr === "string" ? result.stderr.trim() : "",
  ].filter((part) => part !== undefined && part.length > 0);
  return parts.join("\n");
}

function hasPositiveFiniteProfileNumbers(profile: ResourceProfile): boolean {
  return (
    Number.isFinite(profile.cpuAllocationCores) &&
    profile.cpuAllocationCores > 0 &&
    Number.isFinite(profile.cpuKillThresholdCores) &&
    profile.cpuKillThresholdCores > 0 &&
    Number.isInteger(profile.memoryAllocationMB) &&
    profile.memoryAllocationMB > 0 &&
    Number.isInteger(profile.memoryKillThresholdMB) &&
    profile.memoryKillThresholdMB > 0
  );
}

function atLeastOne(value: number): number {
  return Number.isFinite(value) ? Math.max(1, value) : 1;
}

function positiveIntegerMB(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.ceil(value)) : 1;
}

function enforceableContainerProfile(
  requestedProfile: ResourceProfile,
): ResourceProfile | null {
  if (!hasPositiveFiniteProfileNumbers(requestedProfile)) {
    return {
      ...requestedProfile,
      cpuAllocationCores: atLeastOne(requestedProfile.cpuAllocationCores),
      cpuKillThresholdCores: atLeastOne(requestedProfile.cpuKillThresholdCores),
      memoryAllocationMB: positiveIntegerMB(requestedProfile.memoryAllocationMB),
      memoryKillThresholdMB: positiveIntegerMB(
        requestedProfile.memoryKillThresholdMB,
      ),
    };
  }
  if (requestedProfile.cpuAllocationCores !== requestedProfile.cpuKillThresholdCores) {
    return {
      ...requestedProfile,
      cpuAllocationCores: requestedProfile.cpuKillThresholdCores,
    };
  }
  if (requestedProfile.memoryAllocationMB > requestedProfile.memoryKillThresholdMB) {
    return {
      ...requestedProfile,
      memoryAllocationMB: requestedProfile.memoryKillThresholdMB,
    };
  }
  return null;
}

function rejectContainerProfile(
  requestedProfile: ResourceProfile,
  enforceableProfile: ResourceProfile,
): ExecutionProfilePreflightResult {
  return {
    status: "rejected",
    backendKind: "container",
    requestedProfile,
    observedOrEnforcedProfile: enforceableProfile,
    verification: "observed",
    gateEligible: false,
    rejectionReason: "requested-observed-mismatch",
    diagnostics: [
      {
        severity: "warning",
        message:
          "Requested resource profile cannot be represented by the Docker-compatible container backend. CPU allocation and kill threshold must match, and memory allocation must not exceed the memory kill threshold.",
      },
    ],
  };
}

function preflightHostSubprocess(
  requestedProfile: ResourceProfile,
): ExecutionProfilePreflightResult {
  const observedProfile = detectHostSubprocessResourceProfile(
    requestedProfile.hostClass,
  );
  const diagnostics = [
    {
      severity: "info" as const,
      message:
        "Host subprocess execution remaps HOME and KOTA_PROJECT_DIR but does not enforce CPU or memory allocation or kill thresholds.",
    },
  ];
  if (!resourceProfilesComparable(requestedProfile, observedProfile)) {
    return {
      status: "rejected",
      backendKind: "host-subprocess",
      requestedProfile,
      observedOrEnforcedProfile: observedProfile,
      verification: "observed",
      gateEligible: false,
      rejectionReason: "requested-observed-mismatch",
      diagnostics: [
        ...diagnostics,
        {
          severity: "warning" as const,
          message:
            "Requested resource profile does not match the observed host subprocess profile; scoring would record misleading execution conditions.",
        },
      ],
    };
  }
  return {
    status: "non-gating",
    backendKind: "host-subprocess",
    requestedProfile,
    observedOrEnforcedProfile: observedProfile,
    verification: "unverified",
    gateEligible: false,
    nonGatingReason: "host-subprocess-unverified",
    diagnostics,
  };
}

function preflightContainerBackend(
  backend: Extract<SubprocessIsolationBackend, { kind: "container" }>,
  requestedProfile: ResourceProfile,
): ExecutionProfilePreflightResult {
  const enforceableProfile = enforceableContainerProfile(requestedProfile);
  if (enforceableProfile !== null) {
    return rejectContainerProfile(requestedProfile, enforceableProfile);
  }

  const probe = spawnSync(backend.executable, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (probe.status !== 0 || probe.error !== undefined) {
    return {
      status: "non-gating",
      backendKind: "missing-isolation-backend",
      requestedProfile,
      observedOrEnforcedProfile: detectHostSubprocessResourceProfile(
        requestedProfile.hostClass,
      ),
      verification: "observed",
      gateEligible: false,
      nonGatingReason: "isolation-backend-unavailable",
      diagnostics: [
        {
          severity: "warning",
          message: `Requested container isolation backend "${backend.executable}" is unavailable, so this run cannot be gate-eligible.`,
        },
      ],
    };
  }
  const imageProbe = spawnSync(
    backend.executable,
    ["image", "inspect", backend.image],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (imageProbe.status !== 0 || imageProbe.error !== undefined) {
    const detail = diagnosticText(imageProbe);
    return {
      status: "non-gating",
      backendKind: "container",
      requestedProfile,
      observedOrEnforcedProfile: requestedProfile,
      verification: "unverified",
      gateEligible: false,
      nonGatingReason: "isolation-backend-config-invalid",
      diagnostics: [
        {
          severity: "warning",
          message:
            `Container image "${backend.image}" is not inspectable through "${backend.executable}", so this run cannot be gate-eligible.` +
            (detail.length > 0 ? ` ${detail}` : ""),
        },
      ],
    };
  }
  return {
    status: "verified",
    backendKind: "container",
    requestedProfile,
    observedOrEnforcedProfile: requestedProfile,
    verification: "enforced",
    gateEligible: true,
    eligibilityReason: "verified-profile",
    diagnostics: [
      {
        severity: "info",
        message:
          `Container backend "${backend.executable}" and image "${backend.image}" are available; run arguments enforce the requested CPU and memory profile and use image-local KOTA binary "${backend.kotaBinaryPath}".`,
      },
    ],
  };
}

function preflightExecutionProfile(
  backend: SubprocessIsolationBackend,
  requestedProfile: ResourceProfile,
): ExecutionProfilePreflightResult {
  switch (backend.kind) {
    case "host-subprocess":
      return preflightHostSubprocess(requestedProfile);
    case "container":
      return preflightContainerBackend(backend, requestedProfile);
  }
}

function envWithReplay(
  request: WorkflowExecutionRequest,
): Record<string, string> {
  return request.replayRecordingsRoot !== undefined
    ? {
        [PRESET_ENV_VAR]: REPLAY_PRESET_ID,
        [REPLAY_AGENT_HARNESS_NAME_ENV]: request.replayRecordingsRoot,
      }
    : {};
}

function hostExecutionEnv(
  options: SubprocessExecutorOptions,
  request: WorkflowExecutionRequest,
  kotaDistDir: string,
): NodeJS.ProcessEnv {
  const basePath = process.env.PATH ?? "";
  const pathWithShims =
    request.externalCallShimDir !== undefined
      ? `${request.externalCallShimDir}:${basePath}`
      : basePath;
  return withProtectedGitBareRepositoryEnv({
    ...process.env,
    ...(options.extraEnv ?? {}),
    HOME: request.workingDir,
    KOTA_PROJECT_DIR: request.workingDir,
    KOTA_DIST_DIR: kotaDistDir,
    PATH: pathWithShims,
    ...envWithReplay(request),
  });
}

function containerExecutionEnv(
  options: SubprocessExecutorOptions,
  request: WorkflowExecutionRequest,
  kotaDistDir: string,
): Record<string, string> {
  const basePath = options.extraEnv?.PATH ?? CONTAINER_DEFAULT_PATH;
  const pathWithShims =
    request.externalCallShimDir !== undefined
      ? `${request.externalCallShimDir}:${basePath}`
      : basePath;
  const env = withProtectedGitBareRepositoryEnv({
    ...(options.extraEnv ?? {}),
    HOME: request.workingDir,
    KOTA_PROJECT_DIR: request.workingDir,
    KOTA_DIST_DIR: kotaDistDir,
    PATH: pathWithShims,
    ...envWithReplay(request),
  });
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function envArgs(env: Record<string, string>): string[] {
  return Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, value]) => ["--env", `${key}=${value}`]);
}

function memoryArg(mb: number): string {
  return `${mb}m`;
}

function cpuArg(cores: number): string {
  return String(cores);
}

function containerKotaDistDir(
  backend: Extract<SubprocessIsolationBackend, { kind: "container" }>,
): string {
  if (!isAbsolute(backend.kotaBinaryPath)) {
    throw new Error(
      "Container isolation backend requires an absolute image-local kotaBinaryPath.",
    );
  }
  return join(dirname(dirname(backend.kotaBinaryPath)), "dist");
}

function workflowExecArgs(
  kotaBinaryPath: string,
  request: WorkflowExecutionRequest,
): string[] {
  const args = [kotaBinaryPath, "workflow", "exec", request.workflowName];
  if (request.triggerPayload !== undefined) {
    args.push("--payload", JSON.stringify(request.triggerPayload));
  }
  return args;
}

function containerRunArgs(params: {
  backend: Extract<SubprocessIsolationBackend, { kind: "container" }>;
  executionProfile: ExecutionProfilePreflightResult;
  workingDir: string;
  replayRecordingsRoot?: string;
  env: Record<string, string>;
  execArgs: string[];
}): string[] {
  const profile = params.executionProfile.observedOrEnforcedProfile;
  const mountArgs = containerMountArgs({
    workingDir: params.workingDir,
    replayRecordingsRoot: params.replayRecordingsRoot,
  });
  return [
    "run",
    "--rm",
    "--init",
    "--network",
    "none",
    "--cpus",
    cpuArg(profile.cpuKillThresholdCores),
    "--memory-reservation",
    memoryArg(profile.memoryAllocationMB),
    "--memory",
    memoryArg(profile.memoryKillThresholdMB),
    ...mountArgs,
    "--workdir",
    params.workingDir,
    ...envArgs(params.env),
    params.backend.image,
    "node",
    ...params.execArgs,
  ];
}

function bindMountArg(source: string, readonly: boolean): string {
  return `type=bind,source=${source},target=${source}${readonly ? ",readonly" : ""}`;
}

function pathIsInsideOrEqual(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function containerMountArgs(params: {
  workingDir: string;
  replayRecordingsRoot?: string;
}): string[] {
  const mounts = [bindMountArg(params.workingDir, false)];
  if (
    params.replayRecordingsRoot !== undefined &&
    !pathIsInsideOrEqual(params.workingDir, params.replayRecordingsRoot)
  ) {
    mounts.push(bindMountArg(params.replayRecordingsRoot, true));
  }
  return mounts.flatMap((mount) => ["--mount", mount]);
}

function isTerminalRunStatus(status: string): boolean {
  return status !== "running";
}

function readWorkflowRunsForWorkflow(
  workingDir: string,
  workflowName: string,
): WorkflowRunMetadataSnapshot[] {
  const runsDir = join(workingDir, ".kota", "runs");
  if (!existsSync(runsDir)) return [];
  const entries = readdirSync(runsDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const snapshots: WorkflowRunMetadataSnapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.includes(workflowName)) continue;
    const metadataPath = join(runsDir, entry.name, "metadata.json");
    if (!existsSync(metadataPath)) continue;
    const raw = JSON.parse(readFileSync(metadataPath, "utf-8")) as {
      id?: unknown;
      status?: unknown;
      workflow?: unknown;
    };
    if (raw.workflow !== workflowName) continue;
    if (typeof raw.status !== "string" || typeof raw.id !== "string") continue;
    snapshots.push({
      id: raw.id,
      status: raw.status,
      terminal: isTerminalRunStatus(raw.status),
    });
  }
  return snapshots;
}

function readTerminalRunForWorkflow(
  workingDir: string,
  workflowName: string,
  existingRunIds: ReadonlySet<string>,
): RunMetadataSnapshot | null {
  const terminalRuns = readWorkflowRunsForWorkflow(workingDir, workflowName)
    .filter((run) => run.terminal && !existingRunIds.has(run.id));
  const terminal = terminalRuns[terminalRuns.length - 1];
  return terminal ? { id: terminal.id, status: terminal.status } : null;
}

/**
 * Build a production-grade subprocess executor. Designed for the cadence
 * workflow and the CLI to use. Unit tests do not use this — they inject
 * lightweight in-process executors to avoid shell and network I/O.
 */
export function createSubprocessExecutor(
  options: SubprocessExecutorOptions,
): WorkflowExecutor {
  const isolationBackend = options.isolationBackend ?? { kind: "host-subprocess" };
  return {
    preflight(requestedProfile) {
      return preflightExecutionProfile(isolationBackend, requestedProfile);
    },
    async execute(request: WorkflowExecutionRequest): Promise<WorkflowExecutionOutcome> {
      const startMs = Date.now();

      // Derive the KOTA dist directory from the binary path so fixture
      // scripts (e.g. a minimal `package.json` whose "validate-tasks"
      // entry forwards to the real validator) can resolve it without
      // hard-coding the operator's checkout path. `bin/kota.mjs` lives
      // one directory above `dist/`.
      const hostKotaRoot = dirname(dirname(resolve(options.kotaBinaryPath)));
      const hostKotaDistDir = join(hostKotaRoot, "dist");
      const hostExecArgs = workflowExecArgs(options.kotaBinaryPath, request);
      const existingWorkflowRunIds = new Set(
        readWorkflowRunsForWorkflow(request.workingDir, request.workflowName).map(
          (run) => run.id,
        ),
      );
      const childSpec =
        isolationBackend.kind === "host-subprocess"
          ? {
              command: "node",
              args: hostExecArgs,
              cwd: request.workingDir,
              env: hostExecutionEnv(options, request, hostKotaDistDir),
              label: "kota workflow exec",
            }
          : request.executionProfile?.status === "verified" &&
              request.executionProfile.backendKind === "container"
            ? {
                command: isolationBackend.executable,
                args: containerRunArgs({
                  backend: isolationBackend,
                  executionProfile: request.executionProfile,
                  workingDir: request.workingDir,
                  replayRecordingsRoot: request.replayRecordingsRoot,
                  env: containerExecutionEnv(
                    options,
                    request,
                    containerKotaDistDir(isolationBackend),
                  ),
                  execArgs: workflowExecArgs(
                    isolationBackend.kotaBinaryPath,
                    request,
                  ),
                }),
                cwd: request.workingDir,
                env: process.env,
                label: `container isolation backend "${isolationBackend.executable}"`,
              }
            : null;

      if (childSpec === null) {
        return {
          kind: "error",
          durationMs: Date.now() - startMs,
          message:
            "Container isolation execution requires a verified container preflight; refusing to downgrade to host subprocess execution.",
          runArtifactPath: null,
        };
      }

      const child = spawn(childSpec.command, childSpec.args, {
        cwd: childSpec.cwd,
        env: childSpec.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.resume();
      // Forward child stderr to the parent so module-load diagnostics and
      // workflow-step errors surface in `pnpm kota eval run` output. Parent
      // logs include the same information the daemon would; piping through
      // here keeps fixture failures debuggable without reading tmp dirs.
      child.stderr.on("data", (chunk) => {
        process.stderr.write(chunk);
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
        return {
          kind: "timeout",
          durationMs,
          runArtifactPath: null,
        };
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

      return {
        kind: "completed",
        durationMs,
        runArtifactPath,
      };
    },
  };
}
