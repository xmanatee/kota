import { type AgentRuntimeSelection, mergePresetTiers, resolveAgentRuntime } from "#core/model/preset.js";
import type { WorkflowValidationOptions } from "./validation-primitives.js";

/** Normalize the definition validator's preset inputs to the runtime shape. */
export function resolveWorkflowValidationAgentRuntime(
  options: WorkflowValidationOptions,
): AgentRuntimeSelection {
  const fallback = resolveAgentRuntime(undefined, {});
  const preset = options.preset ?? fallback.preset;
  return {
    preset,
    harness: options.defaultAgentHarness ?? preset.harness,
    tiers: mergePresetTiers(preset, options.modelTiers),
    effort: options.defaultAgentEffort ?? preset.defaultEffort,
  };
}
