import type { AgentHarness } from "#core/agent-harness/index.js";
import { PROVIDER_PRESETS, parseModelString } from "./factory.js";
import { validateOpenAIChatCompletionsToolModel } from "./openai/request-body.js";

/** Resolve a provider/model selection against the registered adapter's contract. */
export function resolveHarnessModel(
  harness: AgentHarness,
  model: string,
  provider: string,
): string {
  const parsed = parseModelString(model);
  if (parsed.provider !== undefined && parsed.provider !== provider) {
    throw new Error(`Model "${model}" conflicts with provider "${provider}".`);
  }
  const routing = harness.modelRouting;
  if (routing === undefined) {
    throw new Error(`Harness "${harness.name}" does not declare model routing.`);
  }
  let resolved: string;
  if (routing.kind === "native") {
    if (routing.provider !== provider) {
      throw new Error(`Harness "${harness.name}" supports provider "${routing.provider}", not "${provider}".`);
    }
    resolved = parsed.model;
  } else {
    if (provider !== "anthropic" && !Object.hasOwn(PROVIDER_PRESETS, provider)) {
      throw new Error(`Unknown ModelClient provider "${provider}".`);
    }
    resolved = `${provider}/${parsed.model}`;
  }
  harness.validateModelId?.(resolved);
  return resolved;
}

/** Static tool-loop admission shares the request encoder's model restriction. */
export function validateToolCallingModelId(model: string): void {
  const parsed = parseModelString(model);
  if (parsed.provider !== undefined) {
    validateOpenAIChatCompletionsToolModel(parsed.provider, parsed.model);
  }
}
