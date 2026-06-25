import type {
  ModuleCapabilityManifestProjection,
  ModuleManifestEffectProjection,
  ModuleManifestEffectSource,
} from "#core/modules/module-manifest.js";
import type { ModuleSummary } from "#core/modules/module-types.js";
import { riskFromEffect, type ToolEffect } from "#core/tools/effect.js";
import { compact, unique } from "./catalog-helpers.js";
import type { ResourceDiscoveryRisk } from "./client.js";

const RISK_WEIGHT: Record<ResourceDiscoveryRisk["risk"], number> = {
  safe: 0,
  moderate: 1,
  dangerous: 2,
};

const EFFECT_KIND_WEIGHT: Record<ToolEffect["kind"], number> = {
  read: 0,
  write: 1,
  destructive: 2,
};

export function risk(effect: ToolEffect | undefined): ResourceDiscoveryRisk | undefined {
  if (!effect) return undefined;
  return { effect, risk: riskFromEffect(effect) };
}

export function manifestEffectsForSource(
  summary: ModuleSummary,
  source: ModuleManifestEffectSource,
): ModuleManifestEffectProjection[] {
  return summary.manifest?.effects.filter((effect) => effect.source === source) ?? [];
}

export function mostSignificantManifestEffect(
  effects: readonly ModuleManifestEffectProjection[],
): ModuleManifestEffectProjection | undefined {
  let selected: ModuleManifestEffectProjection | undefined;
  for (const effect of effects) {
    if (!selected) {
      selected = effect;
      continue;
    }
    const riskDelta = RISK_WEIGHT[effect.risk] - RISK_WEIGHT[selected.risk];
    if (riskDelta > 0) {
      selected = effect;
      continue;
    }
    if (riskDelta < 0) continue;
    const kindDelta =
      EFFECT_KIND_WEIGHT[effect.effect.kind] - EFFECT_KIND_WEIGHT[selected.effect.kind];
    if (kindDelta > 0) selected = effect;
  }
  return selected;
}

export function manifestRisk(
  effect: ModuleManifestEffectProjection | undefined,
): ResourceDiscoveryRisk | undefined {
  if (!effect) return undefined;
  return { effect: effect.effect, risk: effect.risk };
}

export function manifestEffectMetadata(
  effects: readonly ModuleManifestEffectProjection[],
): Readonly<Record<string, string | number | boolean>> {
  if (effects.length === 0) return {};
  const primary = mostSignificantManifestEffect(effects);
  return {
    effectIds: effects.map((effect) => effect.id).join(","),
    effectSources: unique(effects.map((effect) => effect.source)).join(","),
    effectCategories: unique(effects.flatMap((effect) => effect.categories)).join(","),
    effectKinds: unique(effects.map((effect) => effect.effect.kind)).join(","),
    effectScopes: unique(effects.map((effect) => effect.effect.scope)).join(","),
    simulationBlocked: effects.some((effect) => effect.simulation.blocked),
    ...(primary
      ? {
          primaryEffectId: primary.id,
          primaryEffectRisk: primary.risk,
        }
      : {}),
  };
}

export function manifestEffectText(
  effects: readonly ModuleManifestEffectProjection[],
): string {
  return compact(
    effects.map((effect) =>
      `${effect.id} ${effect.description} ${effect.source} ${effect.risk} ${effect.categories.join(" ")} ${effect.effect.kind} ${effect.effect.scope}`
    ),
  );
}

export function capabilityText(
  manifest: ModuleCapabilityManifestProjection | undefined,
): string {
  if (!manifest) return "";
  return compact([
    ...manifest.capabilities.map((capability) =>
      `${capability.id} ${capability.description} ${capability.scopePolicyHooks.join(" ")}`
    ),
    ...manifest.effects.map((effect) =>
      `${effect.id} ${effect.description} ${effect.risk} ${effect.categories.join(" ")}`
    ),
  ]);
}

export function contributionText(summary: ModuleSummary): string {
  return compact([
    summary.toolNames.join(" "),
    summary.workflowNames.join(" "),
    summary.channelNames.join(" "),
    summary.skillNames.join(" "),
    summary.agentNames.join(" "),
    summary.commandNames.join(" "),
    summary.routeSummaries.join(" "),
  ]);
}
