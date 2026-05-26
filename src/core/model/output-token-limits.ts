import { listShippedPresets } from "./preset.js";

export type ModelOutputTokenLimits = Readonly<Record<string, number>>;

export type ModelOutputTokenLimitSource =
  | "shipped-preset"
  | "operator-config";

export type ResolvedModelOutputTokenLimit = {
  readonly model: string;
  readonly matchedModel: string;
  readonly maxTokens: number;
  readonly source: ModelOutputTokenLimitSource;
};

function validateLimit(model: string, limit: number): void {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      `Invalid output-token limit for model "${model}": expected a positive integer.`,
    );
  }
}

function buildShippedModelOutputTokenLimits(): ModelOutputTokenLimits {
  const limits: Record<string, number> = {};
  for (const preset of listShippedPresets()) {
    const entries = [
      [preset.tiers.fast, preset.outputTokenLimits.fast],
      [preset.tiers.balanced, preset.outputTokenLimits.balanced],
      [preset.tiers.capable, preset.outputTokenLimits.capable],
    ] as const;

    for (const [model, limit] of entries) {
      validateLimit(model, limit);
      const existing = limits[model];
      if (existing !== undefined && existing !== limit) {
        throw new Error(
          `Conflicting shipped output-token limits for model "${model}".`,
        );
      }
      limits[model] = limit;
    }

    if (limits[preset.defaultModel] === undefined) {
      throw new Error(
        `Preset "${preset.id}" default model "${preset.defaultModel}" is missing an output-token limit.`,
      );
    }
  }
  return limits;
}

const SHIPPED_MODEL_OUTPUT_TOKEN_LIMITS: ModelOutputTokenLimits =
  buildShippedModelOutputTokenLimits();

function providerlessModel(model: string): string | undefined {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return undefined;
  return model.slice(slash + 1);
}

function getConfiguredLimit(
  model: string,
  limits: ModelOutputTokenLimits | undefined,
): { matchedModel: string; maxTokens: number } | undefined {
  if (!limits) return undefined;
  const exact = limits[model];
  if (exact !== undefined) {
    validateLimit(model, exact);
    return { matchedModel: model, maxTokens: exact };
  }
  const stripped = providerlessModel(model);
  if (stripped === undefined) return undefined;
  const strippedLimit = limits[stripped];
  if (strippedLimit === undefined) return undefined;
  validateLimit(stripped, strippedLimit);
  return { matchedModel: stripped, maxTokens: strippedLimit };
}

function getShippedLimit(
  model: string,
): { matchedModel: string; maxTokens: number } | undefined {
  const exact = SHIPPED_MODEL_OUTPUT_TOKEN_LIMITS[model];
  if (exact !== undefined) return { matchedModel: model, maxTokens: exact };
  const stripped = providerlessModel(model);
  if (stripped === undefined) return undefined;
  const strippedLimit = SHIPPED_MODEL_OUTPUT_TOKEN_LIMITS[stripped];
  if (strippedLimit === undefined) return undefined;
  return { matchedModel: stripped, maxTokens: strippedLimit };
}

export function resolveModelOutputTokenLimit(
  model: string,
  configuredLimits?: ModelOutputTokenLimits,
): ResolvedModelOutputTokenLimit {
  const configured = getConfiguredLimit(model, configuredLimits);
  if (configured !== undefined) {
    return {
      model,
      matchedModel: configured.matchedModel,
      maxTokens: configured.maxTokens,
      source: "operator-config",
    };
  }

  const shipped = getShippedLimit(model);
  if (shipped !== undefined) {
    return {
      model,
      matchedModel: shipped.matchedModel,
      maxTokens: shipped.maxTokens,
      source: "shipped-preset",
    };
  }

  throw new Error(
    `No output-token limit configured for model "${model}". ` +
      "Add config.modelOutputTokenLimits[model] with an explicit positive integer before routing this model through a KOTA ModelClient harness.",
  );
}

export function listShippedModelOutputTokenLimits(): ModelOutputTokenLimits {
  return SHIPPED_MODEL_OUTPUT_TOKEN_LIMITS;
}

export function listShippedPresetModelIds(): readonly string[] {
  return [
    ...new Set(
      listShippedPresets().flatMap((preset) => [
        preset.defaultModel,
        preset.tiers.fast,
        preset.tiers.balanced,
        preset.tiers.capable,
      ]),
    ),
  ];
}
