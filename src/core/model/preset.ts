/**
 * Preset abstraction: a named bundle of (harness, defaultModel, tiers,
 * defaultEffort, authEnv).
 *
 * Switching presets is one switch — `--preset <id>` CLI flag,
 * `KOTA_PRESET` env, or `config.defaultPreset` — that flips harness +
 * default model + fast/balanced/capable tier mapping + default reasoning
 * effort + auth contract together. `authEnv` is empty only for harnesses
 * that authenticate through their own local login state. Adapters keep
 * ownership of effort translation (codex/gemini map the neutral
 * `AgentEffort` literal to their provider's wire shape).
 *
 * Resolution priority (gemini-cli convention): CLI flag > env > project
 * config > user config > shipped default. No silent fallback to another
 * preset when the active preset is explicitly named; resolution that returns
 * nothing throws with the consumer named.
 *
 * The shipped registry below is the single place new model ids land when
 * a vendor releases a new tier. Per `feedback_no_cost_bias_in_autonomy`
 * we do not add cost-aware routing; tier mapping is preset-data, not
 * autonomy-runtime.
 */
import type { AgentEffort } from "#core/agent-harness/types.js";
import type { ModelTier, ModelTiers } from "./model-router.js";

export type PresetId = string;

export type PresetTiers = {
  readonly fast: string;
  readonly balanced: string;
  readonly capable: string;
};

export type Preset = {
  readonly id: PresetId;
  readonly description: string;
  readonly harness: string;
  readonly authEnv: readonly string[];
  readonly defaultModel: string;
  readonly tiers: PresetTiers;
  readonly defaultEffort: AgentEffort;
};

const SHIPPED_PRESETS: readonly Preset[] = [
  {
    id: "claude",
    description: "Anthropic Claude via @anthropic-ai/claude-agent-sdk.",
    harness: "claude-agent-sdk",
    authEnv: ["ANTHROPIC_API_KEY"],
    defaultModel: "claude-sonnet-4-6",
    tiers: {
      fast: "claude-haiku-4-5-20251001",
      balanced: "claude-sonnet-4-6",
      capable: "claude-opus-4-7",
    },
    defaultEffort: "xhigh",
  },
  {
    id: "codex",
    description: "OpenAI Codex via the local Codex CLI.",
    harness: "codex",
    authEnv: [],
    defaultModel: "gpt-5.5",
    tiers: {
      fast: "gpt-5.4-mini",
      balanced: "gpt-5.4",
      capable: "gpt-5.5",
    },
    defaultEffort: "xhigh",
  },
  {
    id: "gemini",
    description: "Google Gemini via @google/genai tool-calling SDK.",
    harness: "gemini",
    authEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    defaultModel: "gemini-2.5-pro",
    tiers: {
      fast: "gemini-2.5-flash-lite",
      balanced: "gemini-2.5-flash",
      capable: "gemini-2.5-pro",
    },
    defaultEffort: "xhigh",
  },
  {
    id: "gemini-cli",
    description:
      "Legacy Google Gemini via the local Gemini CLI. Consumer Google AI Pro / Ultra and free individual access ends June 18, 2026; use antigravity-cli for Google's current native CLI path.",
    harness: "gemini-cli",
    authEnv: [],
    defaultModel: "gemini-2.5-pro",
    tiers: {
      fast: "gemini-2.5-flash-lite",
      balanced: "gemini-2.5-flash",
      capable: "gemini-2.5-pro",
    },
    defaultEffort: "xhigh",
  },
  {
    id: "antigravity-cli",
    description:
      "Google Antigravity via the local AGY CLI readiness path. Execution is unsupported until AGY documents stable headless structured output.",
    harness: "antigravity-cli",
    authEnv: [],
    defaultModel: "gemini-3.5-flash",
    tiers: {
      fast: "gemini-3.5-flash",
      balanced: "gemini-3.5-flash",
      capable: "gemini-3.5-flash",
    },
    defaultEffort: "xhigh",
  },
];

const PRESET_INDEX: ReadonlyMap<PresetId, Preset> = new Map(
  SHIPPED_PRESETS.map((preset) => [preset.id, preset]),
);

/** The preset KOTA selects when none is configured. Always present in `SHIPPED_PRESETS`. */
export const SHIPPED_DEFAULT_PRESET_ID: PresetId = "codex";

/** Env var name that sets the active preset for the current process. */
export const PRESET_ENV_VAR = "KOTA_PRESET";

export function listShippedPresets(): readonly Preset[] {
  return SHIPPED_PRESETS;
}

export function listShippedPresetIds(): readonly PresetId[] {
  return SHIPPED_PRESETS.map((preset) => preset.id);
}

export function hasPreset(id: PresetId): boolean {
  return PRESET_INDEX.has(id);
}

export function getPreset(id: PresetId): Preset {
  const preset = PRESET_INDEX.get(id);
  if (!preset) {
    throw new Error(
      `Unknown preset "${id}". Shipped presets: ${listShippedPresetIds().join(", ")}.`,
    );
  }
  return preset;
}

/**
 * Read the preset's shipped default model. Consumers should pass the active
 * preset (resolved via `resolvePreset` or `resolveActivePresetFromConfig`)
 * instead of repeating a model literal.
 */
export function resolveDefaultModel(preset: Preset): string {
  return preset.defaultModel;
}

/** Read the preset's shipped default reasoning effort. */
export function resolveDefaultEffort(preset: Preset): AgentEffort {
  return preset.defaultEffort;
}

/**
 * Resolve a tier through a preset, honoring operator tier overrides. Alias for
 * `resolvePresetTierModel` to give consumers a stable name that mirrors
 * `resolveDefaultModel` and `resolveDefaultEffort`.
 */
export function resolveTierModel(
  preset: Preset,
  tier: ModelTier,
  overrides?: ModelTiers,
): string {
  return resolvePresetTierModel(preset, tier, overrides);
}

export type PresetSource = "flag" | "env" | "config" | "default";

export type PresetResolution = {
  readonly preset: Preset;
  readonly source: PresetSource;
};

export type PresetResolutionInput = {
  /** `--preset <id>` CLI flag value. */
  flag?: string;
  /** `KOTA_PRESET` env var value. */
  env?: string;
  /** `config.defaultPreset` from the merged KOTA config. */
  config?: string;
};

/**
 * Resolve the active preset. Priority: flag > env > config > shipped default.
 * Throws when an explicitly named preset (flag/env/config) does not exist;
 * never falls back silently to a different preset.
 */
export function resolvePreset(input: PresetResolutionInput): PresetResolution {
  if (input.flag !== undefined && input.flag !== "") {
    return { preset: getPreset(input.flag), source: "flag" };
  }
  if (input.env !== undefined && input.env !== "") {
    return { preset: getPreset(input.env), source: "env" };
  }
  if (input.config !== undefined && input.config !== "") {
    return { preset: getPreset(input.config), source: "config" };
  }
  return { preset: getPreset(SHIPPED_DEFAULT_PRESET_ID), source: "default" };
}

/**
 * Resolve the active preset from a loaded config plus the process env. Used by
 * non-CLI consumers (capture, answer, daemon-init, history) that need the
 * shipped default when `config.model` is unset.
 */
export function resolveActivePresetFromConfig(
  config: { defaultPreset?: string } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Preset {
  return resolvePreset({
    env: env[PRESET_ENV_VAR],
    config: config?.defaultPreset,
  }).preset;
}

/** Merge a preset's tier mapping with operator overrides. Operator wins per tier. */
export function mergePresetTiers(
  preset: Preset,
  overrides: ModelTiers | undefined,
): Required<ModelTiers> {
  return {
    fast: overrides?.fast || preset.tiers.fast,
    balanced: overrides?.balanced || preset.tiers.balanced,
    capable: overrides?.capable || preset.tiers.capable,
  };
}

/** Resolve a tier through a preset, honoring operator tier overrides. */
export function resolvePresetTierModel(
  preset: Preset,
  tier: ModelTier,
  overrides?: ModelTiers,
): string {
  const tiers = mergePresetTiers(preset, overrides);
  return tiers[tier];
}

export type PresetAuthCheck = {
  readonly preset: Preset;
  /** Subset of `preset.authEnv` not set in the inspected environment. */
  readonly missing: readonly string[];
};

/**
 * Inspect process env (or the supplied env) for the preset's required auth
 * vars. A preset that lists multiple alternates (e.g. gemini accepts
 * `GEMINI_API_KEY` *or* `GOOGLE_API_KEY`) is satisfied when any of them is
 * set; only when all are absent does the check report missing.
 */
export function checkPresetAuth(
  preset: Preset,
  env: NodeJS.ProcessEnv = process.env,
): PresetAuthCheck {
  if (preset.authEnv.length === 0) {
    return { preset, missing: [] };
  }
  const anyPresent = preset.authEnv.some((name) => Boolean(env[name]));
  if (anyPresent) return { preset, missing: [] };
  return { preset, missing: preset.authEnv };
}
