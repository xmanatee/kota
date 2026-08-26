import { riskFromEffect, type ToolEffect } from "#core/tools/effect.js";
import type {
  ModuleManifestEffectCategory,
  ModuleManifestEffectProjection,
  ModuleManifestEffectSource,
  ModuleManifestSimulation,
} from "./module-manifest.js";

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function effectCategoriesFromEffect(
  effect: ToolEffect,
): ModuleManifestEffectCategory[] {
  const categories: ModuleManifestEffectCategory[] = [];
  if (effect.kind === "destructive") categories.push("destructive");
  if (effect.scope === "external-network") {
    categories.push(effect.kind === "read" ? "network-read" : "external-write");
  }
  if (effect.scope === "local-fs" && effect.kind !== "read") {
    categories.push("local-write");
  }
  if (effect.scope === "daemon-state" && effect.kind !== "read") {
    categories.push("daemon-mutation");
  }
  if (effect.scope === "operator-surface") {
    categories.push("notification", "owner-visible");
  }
  if (effect.scope === "process-env" && effect.kind !== "read") {
    categories.push("credential");
  }
  if (effect.scope === "session" && effect.kind !== "read") {
    categories.push("session-write");
  }
  return categories;
}

function effectRequiresExplicitManifest(effect: ToolEffect): boolean {
  return effect.scope === "external-network" ||
    effect.scope === "operator-surface" ||
    effect.kind === "destructive";
}

export function simulationBlockReasonFromEffect(
  tool: string,
  effect: ToolEffect,
  opts: { canScopeLocalFs: boolean },
): string | undefined {
  if (effect.kind === "destructive") {
    return "tool would produce a destructive side effect in trial mode";
  }
  if (effect.scope === "external-network" || effect.scope === "operator-surface") {
    return "tool would produce a live external or operator-visible side effect in trial mode";
  }
  if (effect.scope === "daemon-state" && effect.kind !== "read") {
    return "tool would mutate daemon state outside the isolated trial scope";
  }
  if (effect.scope === "process-env" && effect.kind !== "read") {
    return "tool would inject values into an execution environment in trial mode";
  }
  if (
    effect.scope === "local-fs" &&
    effect.kind !== "read" &&
    !opts.canScopeLocalFs
  ) {
    return `tool "${tool}" has local filesystem side effects that trial mode cannot root in the isolated scope`;
  }
  return undefined;
}

export function buildModuleManifestEffectProjection(args: {
  id: string;
  description: string;
  source: ModuleManifestEffectSource;
  target: string;
  effect: ToolEffect;
  capabilityIds: readonly string[];
}): ModuleManifestEffectProjection {
  const reason = simulationBlockReasonFromEffect(args.target, args.effect, {
    canScopeLocalFs: false,
  });
  return {
    id: args.id,
    description: args.description,
    source: args.source,
    target: args.target,
    effect: args.effect,
    risk: riskFromEffect(args.effect),
    categories: effectCategoriesFromEffect(args.effect),
    capabilityIds: args.capabilityIds,
    simulation: reason
      ? { blocked: true, reason }
      : { blocked: false },
  };
}

export function deriveModuleManifestSimulation(
  effects: readonly ModuleManifestEffectProjection[],
): ModuleManifestSimulation {
  const blockedReasons = unique(
    effects
      .map((effect) => effect.simulation.reason)
      .filter((reason): reason is string => reason !== undefined),
  );
  if (blockedReasons.length > 0) {
    return { support: "external-effects-blocked", blockedReasons };
  }
  const localMutation = effects.some((effect) =>
    effect.categories.includes("local-write") ||
    effect.categories.includes("session-write")
  );
  if (localMutation) return { support: "local-isolated", blockedReasons: [] };
  return { support: "full", blockedReasons: [] };
}

export function validateModuleManifestSimulation(
  moduleName: string,
  simulation: ModuleManifestSimulation,
  effects: readonly ModuleManifestEffectProjection[],
): void {
  const blockedEffects = effects.filter((effect) => effect.simulation.blocked);
  if (blockedEffects.length === 0) {
    if (
      (simulation.support === "external-effects-blocked" ||
        simulation.support === "unsupported") &&
      simulation.blockedReasons.length === 0
    ) {
      throw new Error(
        `Module "${moduleName}" manifest simulation support "${simulation.support}" must declare blocked reasons`,
      );
    }
    return;
  }
  if (simulation.support === "full") {
    throw new Error(
      `Module "${moduleName}" manifest simulation support "full" conflicts with blocked effects: ${blockedEffects.map((effect) => effect.id).join(", ")}`,
    );
  }
  if (simulation.blockedReasons.length === 0) {
    throw new Error(
      `Module "${moduleName}" manifest simulation must declare blocked reasons for blocked effects: ${blockedEffects.map((effect) => effect.id).join(", ")}`,
    );
  }
}

export function assertManifestRequiredForEffects(
  moduleName: string,
  effects: readonly ModuleManifestEffectProjection[],
): void {
  const uncovered = effects.filter((effect) =>
    effectRequiresExplicitManifest(effect.effect)
  );
  if (uncovered.length === 0) return;
  throw new Error(
    `Module "${moduleName}" must declare a manifest because it contributes external, operator-visible, or destructive effects: ${uncovered.map((effect) => effect.id).join(", ")}`,
  );
}
