import type {
  ModuleCapabilityManifestProjection,
  ModuleManifestSetupSnapshot,
} from "#core/modules/module-manifest.js";
import type { ModuleSummary } from "#core/modules/module-types.js";
import type { ToolEffect } from "#core/tools/effect.js";
import type {
  ResourceDiscoveryReadiness,
  ResourceDiscoverySetupBlocker,
} from "./client.js";

function ready(message = "Resource is available."): ResourceDiscoveryReadiness {
  return { status: "ready", message };
}

export function readOnly(
  message = "Resource is available for read-only inspection.",
): ResourceDiscoveryReadiness {
  return { status: "read_only", message };
}

export function unavailable(reason: string, message: string): ResourceDiscoveryReadiness {
  return { status: "unavailable", reason, message };
}

function setupBlocked(
  blockers: readonly ResourceDiscoverySetupBlocker[],
): ResourceDiscoveryReadiness {
  return {
    status: "setup_blocked",
    message: blockers
      .map((blocker) => `${blocker.moduleName}/${blocker.requirementId}: ${blocker.message}`)
      .join("; "),
    blockers,
  };
}

function setupBlocker(
  moduleName: string,
  req: ModuleManifestSetupSnapshot,
): ResourceDiscoverySetupBlocker | null {
  const availability = req.availability;
  if (!availability || availability.state === "ready") return null;
  return {
    moduleName,
    requirementId: req.id,
    title: req.id,
    state: availability.state,
    reason: availability.reason,
    message: availability.message,
    statusLinks: req.statusLinks,
  };
}

function setupBlockersForRequirements(
  moduleName: string,
  requirements: readonly ModuleManifestSetupSnapshot[],
  includeOptional: boolean,
): ResourceDiscoverySetupBlocker[] {
  return requirements
    .filter((req) => includeOptional || req.required)
    .map((req) => setupBlocker(moduleName, req))
    .filter((blocker): blocker is ResourceDiscoverySetupBlocker => blocker !== null);
}

function capabilitySetupIds(
  manifest: ModuleCapabilityManifestProjection,
  capabilityIds: readonly string[],
): Set<string> {
  const ids = new Set<string>();
  for (const capability of manifest.capabilities) {
    if (!capabilityIds.includes(capability.id)) continue;
    for (const setupId of capability.setupRequirementIds ?? []) ids.add(setupId);
  }
  return ids;
}

function setupBlockersForTool(
  summary: ModuleSummary | undefined,
  toolName: string,
): ResourceDiscoverySetupBlocker[] {
  const manifest = summary?.manifest;
  if (!summary || !manifest) return [];
  const toolEffect = manifest.effects.find((effect) =>
    effect.source === "tool" && effect.target === toolName
  );
  const setupIds = toolEffect
    ? capabilitySetupIds(manifest, toolEffect.capabilityIds)
    : new Set(manifest.readiness.setupRequirementIds);
  const relevant = manifest.contributions.setupRequirements.filter((req) => setupIds.has(req.id));
  return setupBlockersForRequirements(summary.name, relevant, false);
}

export function moduleReadiness(
  summary: ModuleSummary | undefined,
  base: "ready" | "read_only",
): ResourceDiscoveryReadiness {
  if (summary?.loadError) return unavailable("module_load_failed", summary.loadError);
  const blockers = summary?.manifest
    ? setupBlockersForRequirements(
        summary.name,
        summary.manifest.contributions.setupRequirements,
        false,
      )
    : [];
  if (blockers.length > 0) return setupBlocked(blockers);
  return base === "read_only" ? readOnly() : ready();
}

export function toolReadiness(
  summary: ModuleSummary | undefined,
  toolName: string,
  effect: ToolEffect | undefined,
): ResourceDiscoveryReadiness {
  if (summary?.loadError) return unavailable("module_load_failed", summary.loadError);
  const blockers = setupBlockersForTool(summary, toolName);
  if (blockers.length > 0) return setupBlocked(blockers);
  return effect?.kind === "read"
    ? readOnly("Tool is read-only.")
    : ready("Tool is available; guardrails still apply.");
}

export function setupReadiness(
  moduleName: string,
  req: ModuleManifestSetupSnapshot,
): ResourceDiscoveryReadiness {
  const blocker = setupBlocker(moduleName, req);
  if (!blocker) return ready("Setup requirement is satisfied.");
  if (req.availability?.state === "unavailable") {
    return unavailable("setup_unavailable", req.availability.message);
  }
  return setupBlocked([blocker]);
}
