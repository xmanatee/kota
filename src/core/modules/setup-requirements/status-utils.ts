import {
  type EvidenceProjectionTarget,
  type EvidenceRetentionScope,
  evidenceRetentionDurationMsFor,
  projectEvidenceObject,
} from "#core/evidence/policy.js";
import type {
  ModuleSetupPendingAction,
  ModuleSetupRequirement,
  ModuleSetupRequirementStatus,
  ModuleSetupScope,
  ModuleSetupSecretRef,
  ModuleSetupStatusState,
} from "./types.js";

export function projectModuleSetupStatusForClient(
  status: ModuleSetupRequirementStatus,
  target: EvidenceProjectionTarget = "daemon-api",
): ModuleSetupRequirementStatus {
  return projectEvidenceObject(status, target) as ModuleSetupRequirementStatus;
}

export function projectModuleSetupPendingActionForClient(
  action: ModuleSetupPendingAction,
  target: EvidenceProjectionTarget = "daemon-api",
): ModuleSetupPendingAction {
  return projectEvidenceObject(action, target) as ModuleSetupPendingAction;
}

export function defaultModuleSetupPendingTtlMs(scope: ModuleSetupScope): number {
  return evidenceRetentionDurationMsFor({
    artifactType: "setup-status",
    state: "pending",
    scope: setupRetentionScope(scope),
  });
}

export function summarizeStatuses(
  statuses: readonly ModuleSetupRequirementStatus[],
): Record<ModuleSetupStatusState, number> {
  const summary: Record<ModuleSetupStatusState, number> = {
    ready: 0,
    missing: 0,
    pending: 0,
    expired: 0,
    revoked: 0,
    unknown: 0,
    unavailable: 0,
  };
  for (const status of statuses) summary[status.state] += 1;
  return summary;
}

export function secretRefsFor(req: ModuleSetupRequirement): readonly ModuleSetupSecretRef[] {
  switch (req.kind) {
    case "secret":
    case "oauth":
      return req.secretRefs;
    case "external-url":
      return req.secretRefs ?? [];
    default:
      return [];
  }
}

function setupRetentionScope(scope: ModuleSetupScope): EvidenceRetentionScope {
  return scope === "global" ? "global" : "directory";
}
