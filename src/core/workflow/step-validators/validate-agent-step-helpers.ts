import {
  listAgentHarnessNames,
  resolveAgentHarness,
} from "#core/agent-harness/registry.js";
import type { AgentTokenBudgetConfig } from "#core/agent-harness/token-budget.js";
import type { AgentHarnessStepOverrides } from "#core/agent-harness/types.js";
import { DEFAULT_MODEL_TIERS, type ModelTier } from "#core/model/model-router.js";
import { mergePresetTiers, type Preset } from "#core/model/preset.js";
import {
  expectNonEmptyString,
  expectOptionalInteger,
  isPlainObject,
  WorkflowDefinitionError,
  type WorkflowValidationOptions,
} from "#core/workflow/validation-primitives.js";

type StepOpaque = unknown;
type StepRecord = Record<string, StepOpaque>;

const VALID_MODEL_TIERS: readonly ModelTier[] = ["fast", "balanced", "capable"];

export function validateTokenBudget(
  value: AgentTokenBudgetConfig | undefined,
  field: string,
  definitionPath: string,
): AgentTokenBudgetConfig | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new WorkflowDefinitionError(`${field} must be an object`, definitionPath);
  }
  return {
    maxTotalTokens: expectOptionalInteger(
      value.maxTotalTokens,
      `${field}.maxTotalTokens`,
      definitionPath,
      1,
    ) ?? missingRequiredTokenBudgetMax(field, definitionPath),
  };
}

function missingRequiredTokenBudgetMax(field: string, definitionPath: string): never {
  throw new WorkflowDefinitionError(
    `${field}.maxTotalTokens is required`,
    definitionPath,
  );
}

export function validateOutputFormat(
  value: StepOpaque,
  stepLabel: string,
  definitionPath: string,
): "json" | undefined {
  if (value === undefined) return undefined;
  if (value !== "json") {
    throw new WorkflowDefinitionError(
      `${stepLabel}.outputFormat must be "json"`,
      definitionPath,
    );
  }
  return "json";
}

export function validateOutputSchema(
  value: StepOpaque,
  outputFormat: StepOpaque,
  stepLabel: string,
  definitionPath: string,
): StepRecord | undefined {
  if (value === undefined) return undefined;
  if (outputFormat !== "json") {
    throw new WorkflowDefinitionError(
      `${stepLabel}.outputSchema requires outputFormat: "json"`,
      definitionPath,
    );
  }
  if (!isPlainObject(value)) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.outputSchema must be an object`,
      definitionPath,
    );
  }
  return value as StepRecord;
}

export function validateHarnessOptions(
  value: StepOpaque,
  harnessName: string,
  stepLabel: string,
  definitionPath: string,
): Record<string, AgentHarnessStepOverrides> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.harnessOptions must be an object`,
      definitionPath,
    );
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return undefined;
  if (keys.length > 1) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.harnessOptions must contain at most one key naming the resolved harness ("${harnessName}"); ` +
        `got keys [${keys.map((k) => `"${k}"`).join(", ")}]`,
      definitionPath,
    );
  }
  const [key] = keys;
  if (key !== harnessName) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.harnessOptions key "${key}" does not match the step's resolved harness "${harnessName}". ` +
        "Options for a harness other than the one that will run the step are not honored.",
      definitionPath,
    );
  }

  let harness: ReturnType<typeof resolveAgentHarness>;
  try {
    harness = resolveAgentHarness(harnessName);
  } catch {
    const available = listAgentHarnessNames();
    const suffix =
      available.length > 0
        ? ` (registered: ${available.join(", ")})`
        : " (no harnesses are registered — load a harness module such as claude-agent-harness)";
    throw new WorkflowDefinitionError(
      `${stepLabel}.harnessOptions references unknown harness "${harnessName}"${suffix}`,
      definitionPath,
    );
  }
  if (!harness.validateStepOptions) {
    throw new WorkflowDefinitionError(
      `${stepLabel}.harnessOptions is set but harness "${harnessName}" declares no per-step options. ` +
        "Drop the harnessOptions block or switch to a harness that accepts one.",
      definitionPath,
    );
  }

  let validated: AgentHarnessStepOverrides;
  try {
    validated = harness.validateStepOptions(value[key]);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new WorkflowDefinitionError(
      `${stepLabel}.harnessOptions["${harnessName}"] rejected by harness validator: ${detail}`,
      definitionPath,
    );
  }
  if (validated === undefined) return undefined;
  return { [harnessName]: validated };
}

export function resolveStepModel(args: {
  rawModel: StepOpaque;
  rawTier: StepOpaque;
  stepLabel: string;
  definitionPath: string;
  preset: Preset | undefined;
  modelTiers: WorkflowValidationOptions["modelTiers"];
}): { model: string; tier: ModelTier | undefined } {
  const { rawModel, rawTier, stepLabel, definitionPath, preset, modelTiers } = args;
  const hasModel = rawModel !== undefined;
  const hasTier = rawTier !== undefined;
  if (hasModel && hasTier) {
    throw new WorkflowDefinitionError(
      `${stepLabel} declares both "model" and "tier" — pick one (use "tier" for harness-portable steps, "model" for an explicit provider id)`,
      definitionPath,
    );
  }
  if (!hasModel && !hasTier) {
    throw new WorkflowDefinitionError(
      `${stepLabel} must declare either "model" (explicit provider id) or "tier" ("fast" | "balanced" | "capable")`,
      definitionPath,
    );
  }

  if (hasTier) {
    const tier = expectNonEmptyString(rawTier, `${stepLabel}.tier`, definitionPath);
    if (!VALID_MODEL_TIERS.includes(tier as ModelTier)) {
      throw new WorkflowDefinitionError(
        `${stepLabel}.tier must be one of ${VALID_MODEL_TIERS.join(", ")}`,
        definitionPath,
      );
    }
    const resolvedTier = tier as ModelTier;
    const tiers = preset
      ? mergePresetTiers(preset, modelTiers)
      : { ...DEFAULT_MODEL_TIERS, ...modelTiers };
    const model = tiers[resolvedTier];
    if (!model) {
      throw new WorkflowDefinitionError(
        `${stepLabel}.tier "${resolvedTier}" did not resolve to a non-empty model id (configure config.modelTiers.${resolvedTier})`,
        definitionPath,
      );
    }
    return { model, tier: resolvedTier };
  }

  const model = expectNonEmptyString(rawModel, `${stepLabel}.model`, definitionPath);
  return { model, tier: undefined };
}
