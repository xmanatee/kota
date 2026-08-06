import type { ToolEffect } from "./effect.js";
import type { ToolRunner } from "./index.js";

export type ToolEffectResolver = (
  input: Parameters<ToolRunner>[0],
) => ToolEffect | undefined;

export type ToolEffectMetadata = {
  effect: ToolEffect;
  resolveEffect?: ToolEffectResolver;
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
  moduleToolEffects.set(name, metadata);
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
