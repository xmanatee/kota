import type {
  ModuleCapabilityManifestProjection,
  ModuleManifestEffectLookup,
} from "#core/modules/module-manifest.js";
import type { ToolEffect } from "./effect.js";
import type { ToolRunner } from "./index.js";

export type ToolEffectResolver = (
  input: Parameters<ToolRunner>[0],
) => ToolEffect | undefined;

export type ToolEffectMetadata = {
  effect: ToolEffect;
  resolveEffect?: ToolEffectResolver;
  moduleName?: string;
  manifestEffect?: ModuleManifestEffectLookup;
  moduleManifest?: ModuleCapabilityManifestProjection;
};

type CoreToolEffectRegistration = ToolEffectMetadata & {
  tool: { name: string };
};

const coreToolEffects = new Map<string, ToolEffectMetadata>();
const moduleToolEffects = new Map<string, ToolEffectMetadata>();

export function setCoreToolEffects(
  registrations: readonly CoreToolEffectRegistration[],
): void {
  coreToolEffects.clear();
  for (const registration of registrations) {
    coreToolEffects.set(registration.tool.name, registration);
  }
}

export function setModuleToolEffect(
  name: string,
  metadata: ToolEffectMetadata,
): void {
  moduleToolEffects.set(name, {
    ...moduleToolEffects.get(name),
    ...metadata,
  });
}

/** Attach a loader-built manifest to its tool registrations without a second manifest registry. */
export function registerModuleToolManifestProjection(
  projection: ModuleCapabilityManifestProjection,
): void {
  for (const effect of projection.effects) {
    if (effect.source !== "tool") continue;
    const existing = moduleToolEffects.get(effect.target);
    moduleToolEffects.set(effect.target, {
      ...existing,
      effect: existing?.effect ?? effect.effect,
      moduleName: projection.moduleName,
      manifestEffect: { ...effect, moduleName: projection.moduleName },
      moduleManifest: projection,
    });
  }
}

export function deleteModuleToolEffect(name: string): void {
  moduleToolEffects.delete(name);
}

export function clearModuleToolEffects(): void {
  moduleToolEffects.clear();
}

export function getModuleToolEffectMetadata(
  name: string,
): ToolEffectMetadata | undefined {
  return moduleToolEffects.get(name);
}

export function getModuleToolManifestEffect(
  name: string,
): ModuleManifestEffectLookup | undefined {
  return moduleToolEffects.get(name)?.manifestEffect;
}

export function getModuleToolManifestProjection(
  name: string,
): ModuleCapabilityManifestProjection | undefined {
  return moduleToolEffects.get(name)?.moduleManifest;
}

export function getRegisteredToolEffectMetadata(
  name: string,
): ToolEffectMetadata | undefined {
  return coreToolEffects.get(name) ?? moduleToolEffects.get(name);
}

export function resolveRegisteredToolEffect(
  name: string,
  input?: Parameters<ToolRunner>[0],
): ToolEffect | undefined {
  const core = coreToolEffects.get(name);
  const module = moduleToolEffects.get(name);
  if (input !== undefined) {
    if (core?.resolveEffect) return core.resolveEffect(input);
    if (module?.resolveEffect) return module.resolveEffect(input);
  }
  return core?.effect ?? module?.effect;
}
