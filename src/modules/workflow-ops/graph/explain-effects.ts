import type {
  ModuleCapabilityManifestProjection,
  ModuleManifestCapability,
  ModuleManifestEffectProjection,
  ModuleManifestSetupSnapshot,
} from "#core/modules/module-manifest.js";
import type { WorkflowStep } from "#core/workflow/step-types.js";
import type {
  AutomationBlocker,
  AutomationEffectSummary,
  AutomationPolicyGate,
} from "./types.js";

type ManifestEffect = {
  moduleName: string;
  effect: ModuleManifestEffectProjection;
};

type CapabilityEntry = {
  moduleName: string;
  capability: ModuleManifestCapability;
  setups: readonly ModuleManifestSetupSnapshot[];
};

export type ManifestLookups = {
  toolEffects: ReadonlyMap<string, ManifestEffect>;
  workflowEffects: ReadonlyMap<string, readonly ManifestEffect[]>;
  capabilities: ReadonlyMap<string, CapabilityEntry>;
};

export function buildLookups(
  manifests: readonly ModuleCapabilityManifestProjection[],
): ManifestLookups {
  const toolEffects = new Map<string, ManifestEffect>();
  const workflowEffects = new Map<string, ManifestEffect[]>();
  const capabilities = new Map<string, CapabilityEntry>();

  for (const manifest of manifests) {
    for (const capability of manifest.capabilities) {
      const setups = manifest.contributions.setupRequirements.filter((setup) =>
        capability.setupRequirementIds?.includes(setup.id)
      );
      capabilities.set(capability.id, {
        moduleName: manifest.moduleName,
        capability,
        setups,
      });
    }

    for (const effect of manifest.effects) {
      const entry = { moduleName: manifest.moduleName, effect };
      if (effect.source === "tool" && !toolEffects.has(effect.target)) {
        toolEffects.set(effect.target, entry);
      }
      if (effect.source === "workflow") {
        const list = workflowEffects.get(effect.target) ?? [];
        workflowEffects.set(effect.target, [...list, entry]);
      }
    }
  }

  return { toolEffects, workflowEffects, capabilities };
}

export function automationEffectSummary(entry: ManifestEffect): AutomationEffectSummary {
  return {
    moduleName: entry.moduleName,
    effectId: entry.effect.id,
    source: entry.effect.source,
    target: entry.effect.target,
    risk: entry.effect.risk,
    categories: entry.effect.categories,
    capabilityIds: entry.effect.capabilityIds,
    effect: {
      kind: entry.effect.effect.kind,
      scope: entry.effect.effect.scope,
      openWorld: entry.effect.effect.openWorld,
    },
    simulation: entry.effect.simulation,
  };
}

export function effectPolicyGates(
  workflowName: string,
  effect: AutomationEffectSummary,
  lookups: ManifestLookups,
): AutomationPolicyGate[] {
  const gates: AutomationPolicyGate[] = [];
  for (const capabilityId of effect.capabilityIds) {
    const capability = lookups.capabilities.get(capabilityId);
    if (!capability) {
      gates.push({
        kind: "scope-policy",
        source: workflowName,
        outcome: "unknown",
        reason: `capability "${capabilityId}" is referenced by ${effect.effectId}, but its manifest entry is unavailable`,
        capabilityIds: [capabilityId],
      });
      continue;
    }
    for (const hook of capability.capability.scopePolicyHooks) {
      gates.push({
        kind: hook === "setup"
          ? "setup"
          : hook === "owner-confirmation"
            ? "owner-confirmation"
            : "scope-policy",
        source: capability.moduleName,
        outcome: hook === "owner-confirmation" ? "confirm" : "unknown",
        reason: `${capability.moduleName}.${capability.capability.id} participates in ${hook} policy`,
        capabilityIds: [capabilityId],
        setupRequirementIds: capability.capability.setupRequirementIds,
      });
    }
  }
  if (effect.simulation.blocked) {
    gates.push({
      kind: "simulation",
      source: effect.moduleName,
      outcome: "block",
      reason: effect.simulation.reason ?? "effect is blocked in simulation",
      capabilityIds: effect.capabilityIds,
    });
  }
  return gates;
}

export function setupBlockers(
  workflowName: string,
  effect: AutomationEffectSummary,
  lookups: ManifestLookups,
): AutomationBlocker[] {
  const blockers: AutomationBlocker[] = [];
  for (const capabilityId of effect.capabilityIds) {
    const capability = lookups.capabilities.get(capabilityId);
    if (!capability) continue;
    for (const setup of capability.setups) {
      if (!setup.required) continue;
      const state = setup.availability?.state ?? "unknown";
      if (state === "ready") continue;
      blockers.push({
        kind: "setup",
        workflow: workflowName,
        moduleName: capability.moduleName,
        capabilityIds: [capabilityId],
        setupRequirementId: setup.id,
        state,
        reason: setup.availability?.message ??
          `setup status for ${capability.moduleName}.${setup.id} is unavailable`,
      });
    }
  }
  return blockers;
}

export function ownerBlockers(
  workflowName: string,
  gates: readonly AutomationPolicyGate[],
): AutomationBlocker[] {
  return gates.flatMap((gate) =>
    gate.kind === "owner-confirmation"
      ? [{
          kind: "owner-confirmation" as const,
          workflow: workflowName,
          capabilityIds: gate.capabilityIds,
          reason: gate.reason,
        }]
      : []
  );
}

export function collectStepEffects(
  steps: readonly WorkflowStep[],
  lookups: ManifestLookups,
): AutomationEffectSummary[] {
  const effects: AutomationEffectSummary[] = [];
  function walk(items: readonly WorkflowStep[]): void {
    for (const step of items) {
      if (step.type === "tool") {
        const effect = lookups.toolEffects.get(step.tool);
        if (effect) effects.push(automationEffectSummary(effect));
      } else if (step.type === "parallel" || step.type === "foreach") {
        walk(step.steps);
      } else if (step.type === "branch") {
        walk(step.ifTrue);
        walk(step.ifFalse);
      }
    }
  }
  walk(steps);
  return effects;
}
