import type {
  ModuleCapabilityManifestProjection,
  ModuleManifestSetupAvailabilitySnapshot,
  ModuleManifestSetupMode,
  ModuleManifestSetupStatusLinks,
} from "./module-manifest.js";
import type {
  ModuleSetupRequirementStatus,
} from "./setup-requirements.js";

export function buildModuleManifestSetupStatusLinks(args: {
  moduleName: string;
  requirementId: string;
  kind: string;
  setupMode: ModuleManifestSetupMode;
}): ModuleManifestSetupStatusLinks {
  const moduleName = encodeURIComponent(args.moduleName);
  const requirementId = encodeURIComponent(args.requirementId);
  const base = `/setup/requirements/${moduleName}/${requirementId}`;
  return {
    list: "/setup/requirements",
    refresh: `${base}/refresh`,
    revoke: base,
    ...(args.setupMode === "form" ? { submitForm: `${base}/form` } : {}),
    ...(args.kind === "secret" || args.kind === "oauth"
      ? { storeSecret: `${base}/secret` }
      : {}),
    ...(args.setupMode === "url" ? { start: `${base}/start` } : {}),
  };
}

function scopeSetupAvailability(
  status: ModuleSetupRequirementStatus,
): ModuleManifestSetupAvailabilitySnapshot {
  return {
    state: status.state,
    reason: status.reason,
    message: status.message,
    ...(status.capabilities !== undefined ? { capabilities: status.capabilities } : {}),
    ...(status.pendingAction !== undefined
      ? {
          pendingAction: {
            ...status.pendingAction,
            complete: `/setup/actions/${encodeURIComponent(status.pendingAction.actionId)}/complete`,
          },
        }
      : {}),
  };
}

export function scopeSetupStatusOntoManifest(
  manifest: ModuleCapabilityManifestProjection,
  statuses: readonly ModuleSetupRequirementStatus[],
): ModuleCapabilityManifestProjection {
  const statusesByRequirement = new Map(
    statuses
      .filter((status) => status.moduleName === manifest.moduleName)
      .map((status) => [status.requirementId, status]),
  );
  return {
    ...manifest,
    contributions: {
      ...manifest.contributions,
      setupRequirements: manifest.contributions.setupRequirements.map((requirement) => {
        const status = statusesByRequirement.get(requirement.id);
        if (status === undefined) return requirement;
        return {
          ...requirement,
          availability: scopeSetupAvailability(status),
        };
      }),
    },
  };
}
