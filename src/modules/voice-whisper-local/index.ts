/**
 * Local whisper.cpp module — registers an opt-in local `TranscriptionProvider`
 * for voice STT. Operators install whisper.cpp separately and point this
 * module at the built binary and a model file. Missing binary or model
 * leaves the provider inactive (logged warning) — never a required
 * dependency for running KOTA.
 */

import { accessSync, constants } from "node:fs";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { STT_PROVIDER_TYPE } from "#modules/voice/types.js";
import { WhisperLocalProvider } from "./provider.js";

export type WhisperLocalModuleConfig = {
  /** Absolute path to the whisper-cli binary. Required. */
  binaryPath: string;
  /** Absolute path to the GGML model file. Required. */
  modelPath: string;
  /** Extra command-line arguments forwarded verbatim (e.g. ["--threads", "4"]). */
  extraArgs?: string[];
  /** Per-invocation timeout in milliseconds. Defaults to 120000. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 120_000;

function isFileReadable(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

const whisperLocalModule: KotaModule = {
  name: "voice-whisper-local",
  version: "1.0.0",
  description: "Opt-in local whisper.cpp STT provider for the voice module",
  dependencies: ["voice"],
  configSchema: {
    type: "object",
    additionalProperties: false,
    required: ["binaryPath", "modelPath"],
    properties: {
      binaryPath: { type: "string", minLength: 1 },
      modelPath: { type: "string", minLength: 1 },
      extraArgs: { type: "array", items: { type: "string" } },
      timeoutMs: { type: "number", minimum: 1000 },
    },
  },

  onLoad(ctx: ModuleContext) {
    const config = ctx.getModuleConfig<WhisperLocalModuleConfig>();
    if (!config?.binaryPath || !config.modelPath) {
      ctx.log.info(
        "voice-whisper-local: binaryPath and modelPath required — provider inactive (local STT opt-in)",
      );
      return;
    }
    if (!isFileReadable(config.binaryPath)) {
      ctx.log.warn(
        `voice-whisper-local: binary not readable at "${config.binaryPath}" — provider inactive`,
      );
      return;
    }
    if (!isFileReadable(config.modelPath)) {
      ctx.log.warn(
        `voice-whisper-local: model not readable at "${config.modelPath}" — provider inactive`,
      );
      return;
    }

    const provider = new WhisperLocalProvider({
      binaryPath: config.binaryPath,
      modelPath: config.modelPath,
      extraArgs: config.extraArgs ?? [],
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    ctx.registerProvider(STT_PROVIDER_TYPE, provider);
    ctx.log.info(`whisper-local provider registered (binary=${config.binaryPath})`);
  },
};

export default whisperLocalModule;
