import { spawnSync } from "node:child_process";
import type {
  ExecutionProfilePreflightResult,
  ExecutionProfileVerification,
} from "./fixture-run.js";
import {
  type ContainerNetworkPolicyRequest,
  type ExecutionNetworkPolicy,
  enforcedProviderEgressNetworkPolicy,
  OFFLINE_CONTAINER_NETWORK_POLICY,
  PROVIDER_EGRESS_NETWORK_LABELS,
  type ProviderEgressTaskSubprocessBoundaryRequest,
  providerEgressEndpointLabelValue,
  providerEgressEndpointsFor,
  providerEgressTaskSubprocessBoundary,
  unavailableProviderEgressNetworkPolicy,
  validateProviderEgressProxyUrl,
} from "./provider-egress.js";
import { diagnosticText } from "./subprocess-executor-diagnostics.js";
import type { ContainerIsolationBackend } from "./subprocess-executor-types.js";

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

function containerNetworkPolicyRequest(
  backend: ContainerIsolationBackend,
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

export function preflightContainerNetworkPolicy(
  backend: ContainerIsolationBackend,
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

export function containerNetworkVerification(
  networkPreflight: ContainerNetworkPreflight,
): ExecutionProfileVerification {
  return networkPreflight.policy.enforcementMode === "docker-internal-proxy"
    ? "enforced"
    : "unverified";
}

export function unavailableContainerNetworkPolicy(
  backend: ContainerIsolationBackend,
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
