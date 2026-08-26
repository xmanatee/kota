import type { KotaConfig } from "#core/config/config.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import { resolveApiKey } from "#modules/model-clients/factory.js";
import {
  getOpenRouterModelCapabilities,
  resolveFreshOpenRouterCandidateSet,
} from "#modules/model-clients/openrouter-catalog.js";
import type {
  HarnessParityMatrixCapabilityMetadata,
  HarnessParityMatrixModelInput,
  HarnessParityMatrixModelRole,
  HarnessParityMatrixOptions,
  HarnessParityMatrixProvider,
  HarnessParityMatrixResult,
} from "./client.js";

export type MatrixModelSpec = {
  role: HarnessParityMatrixModelRole;
  label: string;
  provider: HarnessParityMatrixProvider;
  model: string;
  requestedModel: string;
  capabilityMetadata: HarnessParityMatrixCapabilityMetadata;
};

export type MatrixOpenRouterPreflight = {
  authEnv: "OPENROUTER_API_KEY";
  authResolver: "model-clients.resolveApiKey";
  available: boolean;
};

function inferProvider(model: string): HarnessParityMatrixProvider {
  if (model.startsWith("openrouter/")) return "openrouter";
  if (model.startsWith("ollama/") || model.startsWith("lmstudio/")) {
    return "local";
  }
  if (model.startsWith("openai/")) return "openai";
  if (model.startsWith("anthropic/")) return "anthropic";
  try {
    getOpenRouterModelCapabilities(model);
    return "openrouter";
  } catch {
    return "unknown";
  }
}

function openRouterCapabilityMetadata(
  model: string,
):
  | {
      ok: true;
      model: string;
      metadata: HarnessParityMatrixCapabilityMetadata;
    }
  | { ok: false; message: string } {
  try {
    const capability = getOpenRouterModelCapabilities(model);
    return {
      ok: true,
      model: capability.providerModelId,
      metadata: {
        status: "available",
        source: "openrouter",
        observedAt: capability.observedAt,
        sourceUrl: capability.sourceUrl,
        contextLength: capability.contextLength,
        maxOutputTokens: capability.maxOutputTokens,
        supportsTools: capability.supportsTools,
        supportsReasoning: capability.supportsReasoning,
        mandatoryReasoning: capability.mandatoryReasoning,
      },
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

function unavailableCapabilityMetadata(
  provider: HarnessParityMatrixProvider,
): HarnessParityMatrixCapabilityMetadata {
  return {
    status: "unavailable",
    reason:
      provider === "local"
        ? "local OpenAI-compatible routes do not have shipped model capability metadata"
        : `no shipped capability metadata resolver for provider "${provider}"`,
  };
}

function buildModelSpec(
  role: HarnessParityMatrixModelRole,
  input: HarnessParityMatrixModelInput,
): MatrixModelSpec | HarnessParityMatrixResult {
  const requestedModel = input.model;
  const provider = input.provider ?? inferProvider(requestedModel);
  const label = input.label ?? `${role}-${requestedModel}`;
  if (provider === "openrouter") {
    const capability = openRouterCapabilityMetadata(requestedModel);
    if (!capability.ok) {
      return {
        ok: false,
        reason: "invalid_model",
        message: capability.message,
      };
    }
    return {
      role,
      label,
      provider,
      model: capability.model,
      requestedModel,
      capabilityMetadata: capability.metadata,
    };
  }
  return {
    role,
    label,
    provider,
    model: requestedModel,
    requestedModel,
    capabilityMetadata: unavailableCapabilityMetadata(provider),
  };
}

function defaultBaseline(config: KotaConfig): HarnessParityMatrixModelInput {
  const preset = resolveActivePresetFromConfig(config);
  return {
    label: `${preset.id}-default`,
    model: preset.defaultModel,
    provider: "active-preset",
  };
}

function expandCandidateSet(
  setId: string,
): HarnessParityMatrixModelInput[] | HarnessParityMatrixResult {
  try {
    return resolveFreshOpenRouterCandidateSet(setId).map((candidate) => ({
      label: `${setId}-${candidate.id}`,
      model: candidate.providerModelId,
      provider: "openrouter" as const,
    }));
  } catch (err) {
    return {
      ok: false,
      reason: "invalid_candidate_set",
      message: (err as Error).message,
    };
  }
}

export function buildModelSpecs(
  config: KotaConfig,
  options: HarnessParityMatrixOptions,
): MatrixModelSpec[] | HarnessParityMatrixResult {
  const baselines =
    options.baselines && options.baselines.length > 0
      ? options.baselines
      : [defaultBaseline(config)];
  const candidates: HarnessParityMatrixModelInput[] = [
    ...(options.candidates ?? []),
  ];
  for (const setId of options.candidateSets ?? []) {
    const expanded = expandCandidateSet(setId);
    if (!Array.isArray(expanded)) return expanded;
    candidates.push(...expanded);
  }

  const specs: MatrixModelSpec[] = [];
  for (const baseline of baselines) {
    const spec = buildModelSpec("baseline", baseline);
    if ("ok" in spec) return spec;
    specs.push(spec);
  }
  for (const candidate of candidates) {
    const spec = buildModelSpec("candidate", candidate);
    if ("ok" in spec) return spec;
    specs.push(spec);
  }
  return specs;
}

export function resolveOpenRouterPreflight(
  scopeRoot: string,
): MatrixOpenRouterPreflight {
  return {
    authEnv: "OPENROUTER_API_KEY",
    authResolver: "model-clients.resolveApiKey",
    available: Boolean(resolveApiKey("openrouter", undefined, { scopeRoot })),
  };
}

export function skipReasonFor(
  spec: MatrixModelSpec,
  openRouterPreflight: MatrixOpenRouterPreflight,
): string | null {
  if (
    (spec.provider === "openrouter" || spec.model.startsWith("openrouter/")) &&
    !openRouterPreflight.available
  ) {
    return "missing OPENROUTER_API_KEY";
  }
  return null;
}
