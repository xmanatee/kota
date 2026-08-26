import { availableParallelism, totalmem } from "node:os";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import { resourceProfilesComparable } from "./fixture-run.js";
import {
  type ExecutionNetworkPolicy,
  HOST_SUBPROCESS_NETWORK_POLICY,
} from "./provider-egress.js";

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

export function enforceableContainerProfile(
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

export function rejectContainerProfile(
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

export function preflightHostSubprocess(
  requestedProfile: ResourceProfile,
): ExecutionProfilePreflightResult {
  const observedProfile = detectHostSubprocessResourceProfile(
    requestedProfile.hostClass,
  );
  const diagnostics = [
    {
      severity: "info" as const,
      message:
        "Host subprocess execution remaps HOME and KOTA_SCOPE_ROOT but does not enforce CPU or memory allocation or kill thresholds.",
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
