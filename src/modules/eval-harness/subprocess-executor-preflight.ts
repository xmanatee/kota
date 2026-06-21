import { spawnSync } from "node:child_process";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import type { ProviderEgressTaskSubprocessBoundaryRequest } from "./provider-egress.js";
import { diagnosticText } from "./subprocess-executor-diagnostics.js";
import {
  containerNetworkVerification,
  preflightContainerNetworkPolicy,
  unavailableContainerNetworkPolicy,
} from "./subprocess-executor-network-preflight.js";
import {
  detectHostSubprocessResourceProfile,
  enforceableContainerProfile,
  preflightHostSubprocess,
  rejectContainerProfile,
} from "./subprocess-executor-resource.js";
import type {
  ContainerIsolationBackend,
  SubprocessIsolationBackend,
} from "./subprocess-executor-types.js";

function preflightContainerBackend(
  backend: ContainerIsolationBackend,
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

export function containerExecutionProfileCanRun(
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

export function preflightExecutionProfile(
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
