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
  ExecutionProfileVerification,
  ResourceProfile,
} from "./fixture-run.js";
import { resourceProfilesComparable } from "./fixture-run.js";
import {
  type ContainerNetworkPolicyRequest,
  type ExecutionNetworkPolicy,
  enforcedProviderEgressNetworkPolicy,
  HOST_SUBPROCESS_NETWORK_POLICY,
  OFFLINE_CONTAINER_NETWORK_POLICY,
  PROVIDER_EGRESS_NETWORK_LABELS,
  type ProviderEgressTaskSubprocessBoundaryRequest,
  providerEgressAuthEnvKeysFor,
  providerEgressEndpointLabelValue,
  providerEgressEndpointsFor,
  providerEgressTaskSubprocessBoundary,
  unavailableProviderEgressNetworkPolicy,
  validateProviderEgressProxyUrl,
} from "./provider-egress.js";
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
   * Active agent harness tool-control facts used to decide whether a
   * provider-egress container can honestly gate. KOTA-hosted tool loops route
   * task subprocesses through KOTA's filtered tool env; native CLI tool loops
   * own their subprocess env and therefore remain runnable but non-gating.
   */
  providerEgressTaskBoundary?: ProviderEgressTaskSubprocessBoundaryRequest;
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
      /**
       * Container network policy. Omitted means the strict offline default:
       * Docker receives `--network none` and no provider proxy env.
       */
      networkPolicy?: ContainerNetworkPolicyRequest;
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

type DockerNetworkInspectRecord = {
  Internal?: boolean;
  Labels?: Record<string, string> | null;
};

type ContainerNetworkPreflight =
  | {
      status: "verified";
      policy: ExecutionNetworkPolicy;
      diagnostics: ExecutionProfilePreflightResult["diagnostics"];
    }
  | {
      status: "non-gating";
      policy: ExecutionNetworkPolicy;
      nonGatingReason: Extract<
        ExecutionProfilePreflightResult,
        { status: "non-gating" }
      >["nonGatingReason"];
      diagnostics: ExecutionProfilePreflightResult["diagnostics"];
    };

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
  networkPolicy: ExecutionNetworkPolicy,
): ExecutionProfilePreflightResult {
  return {
    status: "rejected",
    backendKind: "container",
    requestedProfile,
    observedOrEnforcedProfile: enforceableProfile,
    verification: "observed",
    networkPolicy,
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
      networkPolicy: HOST_SUBPROCESS_NETWORK_POLICY,
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
    networkPolicy: HOST_SUBPROCESS_NETWORK_POLICY,
    gateEligible: false,
    nonGatingReason: "host-subprocess-unverified",
    diagnostics,
  };
}

function containerNetworkPolicyRequest(
  backend: Extract<SubprocessIsolationBackend, { kind: "container" }>,
): ContainerNetworkPolicyRequest {
  return backend.networkPolicy ?? { kind: "offline" };
}

function nonGatingNetworkPreflight(params: {
  request: Extract<ContainerNetworkPolicyRequest, { kind: "provider-egress" }>;
  taskBoundary?: ProviderEgressTaskSubprocessBoundaryRequest;
  reason: Extract<
    ExecutionProfilePreflightResult,
    { status: "non-gating" }
  >["nonGatingReason"];
  message: string;
}): ContainerNetworkPreflight {
  return {
    status: "non-gating",
    policy: unavailableProviderEgressNetworkPolicy(
      params.request,
      providerEgressTaskSubprocessBoundary(params.taskBoundary),
    ),
    nonGatingReason: params.reason,
    diagnostics: [{ severity: "warning", message: params.message }],
  };
}

function parseDockerNetworkInspect(
  stdout: string,
): DockerNetworkInspectRecord | null {
  try {
    const parsed = JSON.parse(stdout) as DockerNetworkInspectRecord[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed[0] ?? null;
  } catch {
    return null;
  }
}

function validateProviderEgressNetwork(
  record: DockerNetworkInspectRecord | null,
  request: Extract<ContainerNetworkPolicyRequest, { kind: "provider-egress" }>,
): string | null {
  if (record === null) {
    return "Docker network inspect did not return a parseable network record.";
  }
  if (record.Internal !== true) {
    return "Provider-egress requires a Docker internal network so the fixture container has no direct broad internet route.";
  }
  const labels = record.Labels ?? {};
  const expectedEndpoints = providerEgressEndpointLabelValue(
    providerEgressEndpointsFor(request.provider),
  );
  if (labels[PROVIDER_EGRESS_NETWORK_LABELS.policy] !== "provider-egress") {
    return `Docker network is missing ${PROVIDER_EGRESS_NETWORK_LABELS.policy}=provider-egress.`;
  }
  if (labels[PROVIDER_EGRESS_NETWORK_LABELS.provider] !== request.provider) {
    return `Docker network provider label must be ${request.provider}.`;
  }
  if (labels[PROVIDER_EGRESS_NETWORK_LABELS.endpoints] !== expectedEndpoints) {
    return `Docker network endpoint label must be ${expectedEndpoints}.`;
  }
  return null;
}

function preflightContainerNetworkPolicy(
  backend: Extract<SubprocessIsolationBackend, { kind: "container" }>,
  taskBoundaryRequest: ProviderEgressTaskSubprocessBoundaryRequest | undefined,
): ContainerNetworkPreflight {
  const request = containerNetworkPolicyRequest(backend);
  if (request.kind === "offline") {
    return {
      status: "verified",
      policy: OFFLINE_CONTAINER_NETWORK_POLICY,
      diagnostics: [
        {
          severity: "info",
          message:
            "Container network policy is offline; Docker run will use --network none.",
        },
      ],
    };
  }

  try {
    validateProviderEgressProxyUrl(request.enforcement.proxyUrl);
  } catch (err) {
    return nonGatingNetworkPreflight({
      request,
      taskBoundary: taskBoundaryRequest,
      reason: "provider-egress-policy-invalid",
      message: (err as Error).message,
    });
  }

  const networkProbe = spawnSync(
    backend.executable,
    ["network", "inspect", request.enforcement.networkName],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (networkProbe.status !== 0 || networkProbe.error !== undefined) {
    const detail = diagnosticText(networkProbe);
    return nonGatingNetworkPreflight({
      request,
      taskBoundary: taskBoundaryRequest,
      reason: "provider-egress-enforcement-unavailable",
      message:
        `Provider-egress Docker network "${request.enforcement.networkName}" is not inspectable through "${backend.executable}".` +
        (detail.length > 0 ? ` ${detail}` : ""),
    });
  }

  const invalidReason = validateProviderEgressNetwork(
    parseDockerNetworkInspect(networkProbe.stdout),
    request,
  );
  if (invalidReason !== null) {
    return nonGatingNetworkPreflight({
      request,
      taskBoundary: taskBoundaryRequest,
      reason: "provider-egress-enforcement-unavailable",
      message: invalidReason,
    });
  }

  const taskBoundary = providerEgressTaskSubprocessBoundary(
    taskBoundaryRequest,
  );
  const policy = enforcedProviderEgressNetworkPolicy(request, taskBoundary);
  if (!policy.gateEligible) {
    const detail =
      taskBoundary.kind === "kota-tool-provider-env-filter"
        ? `agent harness "${taskBoundary.agentHarness}" routes tools through KOTA, so task subprocesses strip provider proxy and auth env, but they still share the fixture container's provider-egress network namespace`
        : taskBoundary.kind === "native-tool-runtime-unverified"
          ? `agent harness "${taskBoundary.agentHarness}" owns a native tool runtime, so KOTA cannot strip provider proxy or auth env from task/candidate subprocesses launched inside that runtime`
          : "the active agent harness could not be resolved, so KOTA cannot prove task/candidate subprocesses strip provider proxy and auth env";
    return {
      status: "non-gating",
      policy,
      nonGatingReason: "provider-egress-task-boundary-unverified",
      diagnostics: [
        {
          severity: "warning",
          message:
            `Provider-egress network "${request.enforcement.networkName}" is enforceable for ${request.provider}, but ${detail}.`,
        },
      ],
    };
  }
  if (taskBoundary.kind !== "kota-tool-provider-env-filter") {
    throw new Error("Internal provider-egress boundary mismatch.");
  }

  return {
    status: "verified",
    policy,
    diagnostics: [
      {
        severity: "info",
        message:
          `Provider-egress network "${request.enforcement.networkName}" is an internal Docker network with allowlist labels for ${request.provider}; ` +
          `agent harness "${taskBoundary.agentHarness}" routes tools through KOTA, so task subprocesses strip provider proxy and auth env before execution.`,
      },
    ],
  };
}

function containerNetworkVerification(
  networkPreflight: ContainerNetworkPreflight,
): ExecutionProfileVerification {
  return networkPreflight.policy.enforcementMode === "docker-internal-proxy"
    ? "enforced"
    : "unverified";
}

function unavailableContainerNetworkPolicy(
  backend: Extract<SubprocessIsolationBackend, { kind: "container" }>,
  taskBoundaryRequest?: ProviderEgressTaskSubprocessBoundaryRequest,
): ExecutionNetworkPolicy {
  const request = containerNetworkPolicyRequest(backend);
  return request.kind === "offline"
    ? OFFLINE_CONTAINER_NETWORK_POLICY
    : unavailableProviderEgressNetworkPolicy(
        request,
        providerEgressTaskSubprocessBoundary(taskBoundaryRequest),
      );
}

function preflightContainerBackend(
  backend: Extract<SubprocessIsolationBackend, { kind: "container" }>,
  requestedProfile: ResourceProfile,
  taskBoundaryRequest: ProviderEgressTaskSubprocessBoundaryRequest | undefined,
): ExecutionProfilePreflightResult {
  const enforceableProfile = enforceableContainerProfile(requestedProfile);
  if (enforceableProfile !== null) {
    return rejectContainerProfile(
      requestedProfile,
      enforceableProfile,
      unavailableContainerNetworkPolicy(backend, taskBoundaryRequest),
    );
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
      networkPolicy: unavailableContainerNetworkPolicy(
        backend,
        taskBoundaryRequest,
      ),
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
      networkPolicy: unavailableContainerNetworkPolicy(
        backend,
        taskBoundaryRequest,
      ),
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
  const networkPreflight = preflightContainerNetworkPolicy(
    backend,
    taskBoundaryRequest,
  );
  if (networkPreflight.status === "non-gating") {
    return {
      status: "non-gating",
      backendKind: "container",
      requestedProfile,
      observedOrEnforcedProfile: requestedProfile,
      verification: containerNetworkVerification(networkPreflight),
      networkPolicy: networkPreflight.policy,
      gateEligible: false,
      nonGatingReason: networkPreflight.nonGatingReason,
      diagnostics: networkPreflight.diagnostics,
    };
  }

  return {
    status: "verified",
    backendKind: "container",
    requestedProfile,
    observedOrEnforcedProfile: requestedProfile,
    verification: "enforced",
    networkPolicy: networkPreflight.policy,
    gateEligible: true,
    eligibilityReason: "verified-profile",
    diagnostics: [
      {
        severity: "info",
        message:
          `Container backend "${backend.executable}" and image "${backend.image}" are available; run arguments enforce the requested CPU and memory profile and use image-local KOTA binary "${backend.kotaBinaryPath}".`,
      },
      ...networkPreflight.diagnostics,
    ],
  };
}

function containerExecutionProfileCanRun(
  profile: ExecutionProfilePreflightResult | undefined,
): profile is ExecutionProfilePreflightResult & { backendKind: "container" } {
  if (profile === undefined || profile.backendKind !== "container") {
    return false;
  }
  if (profile.status === "verified") return true;
  return (
    profile.status === "non-gating" &&
    profile.nonGatingReason === "provider-egress-task-boundary-unverified" &&
    profile.networkPolicy.kind === "provider-egress" &&
    profile.networkPolicy.enforcementMode === "docker-internal-proxy"
  );
}

function preflightExecutionProfile(
  backend: SubprocessIsolationBackend,
  requestedProfile: ResourceProfile,
  taskBoundaryRequest: ProviderEgressTaskSubprocessBoundaryRequest | undefined,
): ExecutionProfilePreflightResult {
  switch (backend.kind) {
    case "host-subprocess":
      return preflightHostSubprocess(requestedProfile);
    case "container":
      return preflightContainerBackend(
        backend,
        requestedProfile,
        taskBoundaryRequest,
      );
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
  networkPolicy: ExecutionNetworkPolicy,
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
    ...containerNetworkEnv(networkPolicy),
    ...envWithReplay(request),
  });
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function containerNetworkEnv(
  networkPolicy: ExecutionNetworkPolicy,
): Record<string, string> {
  if (
    networkPolicy.kind !== "provider-egress" ||
    networkPolicy.enforcementMode !== "docker-internal-proxy"
  ) {
    return {};
  }
  const endpoints = providerEgressEndpointLabelValue(
    networkPolicy.allowedProviderEndpoints,
  );
  return {
    KOTA_EVAL_PROVIDER_EGRESS_ACTIVE: "1",
    KOTA_EVAL_PROVIDER_EGRESS_AUTH_ENV_KEYS:
      providerEgressAuthEnvKeysFor(networkPolicy.provider).join(","),
    HTTP_PROXY: networkPolicy.proxyUrl,
    HTTPS_PROXY: networkPolicy.proxyUrl,
    KOTA_EVAL_PROVIDER_EGRESS_ENDPOINTS: endpoints,
    KOTA_EVAL_PROVIDER_EGRESS_PROVIDER: networkPolicy.provider,
    KOTA_EVAL_PROVIDER_EGRESS_PROXY_URL: networkPolicy.proxyUrl,
    KOTA_EVAL_PROVIDER_EGRESS_SCOPE: networkPolicy.containerNetworkScope,
    KOTA_EVAL_PROVIDER_EGRESS_TASK_BOUNDARY:
      networkPolicy.taskSubprocessBoundary.kind,
    ...(networkPolicy.taskSubprocessBoundary.kind !==
    "agent-harness-unresolved"
      ? {
          KOTA_EVAL_PROVIDER_EGRESS_AGENT_HARNESS:
            networkPolicy.taskSubprocessBoundary.agentHarness,
        }
      : {}),
  };
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
  const networkPolicy = params.executionProfile.networkPolicy;
  const mountArgs = containerMountArgs({
    workingDir: params.workingDir,
    replayRecordingsRoot: params.replayRecordingsRoot,
  });
  return [
    "run",
    "--rm",
    "--init",
    ...containerNetworkArgs(networkPolicy),
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

function containerNetworkArgs(networkPolicy: ExecutionNetworkPolicy): string[] {
  if (
    networkPolicy.kind === "provider-egress" &&
    networkPolicy.enforcementMode === "docker-internal-proxy"
  ) {
    return ["--network", networkPolicy.networkName];
  }
  return ["--network", "none"];
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
      return preflightExecutionProfile(
        isolationBackend,
        requestedProfile,
        options.providerEgressTaskBoundary,
      );
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
          : containerExecutionProfileCanRun(request.executionProfile)
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
                    request.executionProfile.networkPolicy,
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
