import type { KotaConfig } from "#core/config/config.js";
import {
  type ModelProviderSelection,
  modelProviderSelectionFromConfig,
} from "#core/model/model-client.js";
import {
  PRESET_ENV_VAR,
  type Preset,
  type PresetResolution,
  resolvePreset,
} from "#core/model/preset.js";
import { parseModelString } from "#modules/model-clients/factory.js";

export type TelegramInteractiveBackend =
  | {
      kind: "model-client";
      modelSpec: string;
      modelProvider?: ModelProviderSelection;
    }
  | {
      kind: "harness";
      harnessName: string;
      model: string;
      modelProvider?: ModelProviderSelection;
      preset: Preset;
      usesPresetHarness: boolean;
    };

export function isModelClientHarness(harnessName: string): boolean {
  return harnessName === "openai-tools" || harnessName === "thin";
}

function resolveActivePreset(config: KotaConfig): PresetResolution {
  return resolvePreset({
    env: process.env[PRESET_ENV_VAR],
    config: config.defaultPreset,
  });
}

function resolveHarnessForPreset(args: {
  configHarness?: string;
  presetResolution: PresetResolution & { preset: Preset };
}): string {
  if (args.presetResolution.source === "env") {
    return args.presetResolution.preset.harness;
  }
  return args.configHarness ?? args.presetResolution.preset.harness;
}

function modelForHarness(modelSpec: string, harnessName: string): string {
  return isModelClientHarness(harnessName)
    ? modelSpec
    : parseModelString(modelSpec).model;
}

function selectsModelClientSession(config: KotaConfig, modelSpec: string): boolean {
  const provider = config.modelProvider?.type;
  if (provider !== undefined) return provider !== "agent-sdk";
  // Telegram's established channel loop owns supervised approvals and
  // provider/model notation. Harness sessions are for native presets such as
  // codex where no ModelClient provider exists.
  return parseModelString(modelSpec).provider !== undefined;
}

export function resolveTelegramInteractiveBackend(
  config: KotaConfig,
  explicitModel?: string,
): TelegramInteractiveBackend {
  const presetResolution = resolveActivePreset(config);
  const preset = presetResolution.preset;
  const modelSpec = explicitModel ?? config.model ?? preset.defaultModel;
  const modelProvider = modelProviderSelectionFromConfig(config);

  if (selectsModelClientSession(config, modelSpec)) {
    return {
      kind: "model-client",
      modelSpec,
      ...(modelProvider !== undefined ? { modelProvider } : {}),
    };
  }

  const harnessName = resolveHarnessForPreset({
    configHarness: config.defaultAgentHarness,
    presetResolution,
  });
  return {
    kind: "harness",
    harnessName,
    model: modelForHarness(modelSpec, harnessName),
    ...(modelProvider !== undefined ? { modelProvider } : {}),
    preset,
    usesPresetHarness: harnessName === preset.harness,
  };
}
