import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "#core/config/config.js";
import { secretReferenceName } from "#core/config/secret-reference.js";
import { createModelClient } from "#core/model/model-client.js";
import { getPreset, resolveActivePresetFromConfig } from "#core/model/preset.js";
import {
  apiKeyNameForProvider,
  resolveApiKey,
  resolveModelProviderName,
} from "#modules/model-clients/factory.js";
import type { DoctorCheckResult } from "./client.js";
import { fail, pass, warn } from "./doctor-results.js";

export function checkProvidersConfig(scopeRoot: string): DoctorCheckResult[] {
  const providers = loadConfig(scopeRoot).providers ?? {};
  const names = Object.entries(providers);
  return names.length === 0
    ? [pass("Providers: configuration", "Using defaults")]
    : [pass("Providers: configuration", names.map(([type, name]) => `${type}=${name}`).join(", "))];
}

function isAuthError(err: Error): boolean {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /API error (401|403)/i.test(msg);
}

const PROBE_MODEL: Record<string, string> = {
  anthropic: getPreset("claude").tiers.fast,
  openai: getPreset("codex").tiers.fast,
  gemini: getPreset("gemini").tiers.fast,
};

function providerCredentialDisplay(
  requiredKeyName: string,
  explicitKey: string | undefined,
  apiKey: string,
): string {
  if (!requiredKeyName) return "(not required)";
  if (!apiKey) return "(not set)";
  const explicitSecretName = explicitKey ? secretReferenceName(explicitKey) : null;
  const displayName = explicitSecretName ?? (explicitKey ? "config.modelProvider.apiKey" : requiredKeyName);
  return `${displayName}=(set)`;
}

export async function checkProviderConnectivity(
  scopeRoot: string,
): Promise<DoctorCheckResult[]> {
  const config = loadConfig(scopeRoot);
  const mpConfig = config.modelProvider;
  const modelSpec = config.model ?? resolveActivePresetFromConfig(config).defaultModel;
  const providerType = resolveModelProviderName(modelSpec, mpConfig?.type);
  if (!providerType) {
    return [warn(
      "Provider connectivity",
      `No model provider configured for ${modelSpec} — use provider/model notation or set config.modelProvider.type`,
    )];
  }
  const explicitKey = mpConfig?.apiKey;
  const requiredKeyName = apiKeyNameForProvider(providerType);
  const apiKey = resolveApiKey(providerType, explicitKey, { scopeRoot });
  const model = PROBE_MODEL[providerType] ?? modelSpec;
  const label = `Provider connectivity: ${providerType}`;
  const keyDisplay = providerCredentialDisplay(requiredKeyName, explicitKey, apiKey);

  if (requiredKeyName && !apiKey) {
    return [warn(label, `API key not set — export ${requiredKeyName} or add apiKey to config.modelProvider`)];
  }
  try {
    const resolved = createModelClient({
      model,
      provider: providerType,
      baseUrl: mpConfig?.baseUrl,
      apiKey,
      scopeRoot,
    });
    await resolved.client.messages.create({
      model: resolved.model,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return [pass(label, `Reachable (model: ${resolved.model}, key: ${keyDisplay})`)];
  } catch (err) {
    if (err instanceof Error && isAuthError(err)) {
      return [fail(label, `Authentication failed (key: ${keyDisplay})`)];
    }
    const msg = err instanceof Error ? err.message : String(err);
    return [fail(label, `Unreachable — ${msg.slice(0, 120)}`)];
  }
}
