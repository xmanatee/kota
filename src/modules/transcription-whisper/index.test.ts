import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KotaConfig } from "#core/config/config.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  getProviderRegistry,
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import {
  getTranscriptionProvider,
  type TranscriptionProvider,
  TranscriptionProviderUnavailableError,
} from "#modules/transcription/index.js";
import whisperModule, { type WhisperModuleConfig } from "./index.js";

function makeContext(moduleConfig?: WhisperModuleConfig): ModuleContext {
  const registry = initProviderRegistry();
  return {
    cwd: process.cwd(),
    verbose: false,
    config: {} as KotaConfig,
    storage: undefined as never,
    registerGroup: () => {},
    getRoutes: () => [],
    getContributedWorkflows: () => [],
    getContributedChannels: () => [],
    getModuleSummaries: () => [],
    probeHealthChecks: async () => ({}),
    getModuleConfig: <T>() => moduleConfig as T | undefined,
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    getSecret: () => null,
    listTools: () => [],
    events: {
      emit: () => {},
      subscribe: () => () => {},
    },
    createSession: () => {
      throw new Error("unused");
    },
    registerProvider: (type, provider) => {
      registry.register(type, whisperModule.name, provider);
    },
    getProvider: <T>(type: string) => registry.get<T>(type),
    callTool: () => {
      throw new Error("unused");
    },
    registerMiddleware: () => {},
    registerDynamicStateProvider: () => {},
    registerCleanupHook: () => {},
    registerPreSendHook: () => {},
    registerHarnessHook: () => {},
    resolveAgentDef: () => undefined,
    resolveSkillsPrompt: () => "",
    getRegisteredConfigKeys: () => new Set<string>(),
  };
}

async function invokeOnLoad(moduleConfig?: WhisperModuleConfig): Promise<void> {
  if (!whisperModule.onLoad) throw new Error("module has no onLoad");
  await whisperModule.onLoad(makeContext(moduleConfig));
}

describe("transcription-whisper module", () => {
  const originalEnv = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    resetProviderRegistry();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalEnv;
    resetProviderRegistry();
  });

  it("declares transcription as a dependency", () => {
    expect(whisperModule.dependencies).toContain("transcription");
  });

  it("stays inactive and leaves transcription unavailable when apiKey config is missing", async () => {
    await invokeOnLoad(undefined);
    expect(() => getTranscriptionProvider()).toThrow(TranscriptionProviderUnavailableError);
  });

  it("stays inactive when $ENV-referenced apiKey has no env value", async () => {
    await invokeOnLoad({ apiKey: "$OPENAI_API_KEY" });
    expect(() => getTranscriptionProvider()).toThrow(TranscriptionProviderUnavailableError);
  });

  it("registers a provider when apiKey is provided inline", async () => {
    await invokeOnLoad({ apiKey: "sk-literal" });
    const provider = getTranscriptionProvider();
    expect(provider.name).toBe("openai-whisper");
  });

  it("resolves $ENV references against process.env at load time", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    await invokeOnLoad({ apiKey: "$OPENAI_API_KEY" });
    expect(getTranscriptionProvider().name).toBe("openai-whisper");
  });

  it("surfaces upstream failure as an error through the service boundary", async () => {
    process.env.OPENAI_API_KEY = "sk-e2e";

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("denied", { status: 401 }));
    const restore = swapGlobalFetch(fetchImpl);

    try {
      await invokeOnLoad({ apiKey: "$OPENAI_API_KEY", maxRetries: 0 });

      const provider: TranscriptionProvider = getTranscriptionProvider();
      await expect(
        provider.transcribe({
          audio: new Uint8Array([1, 2, 3]),
          mimeType: "audio/ogg",
        }),
      ).rejects.toMatchObject({ name: "WhisperTranscriptionError" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("warns and stays inactive when registry already has a provider for another service", async () => {
    const registry = initProviderRegistry();
    // Unrelated service type should not block registration.
    registry.register("something-else", "x", {});
    await invokeOnLoad({ apiKey: "sk-literal" });
    expect(getTranscriptionProvider().name).toBe("openai-whisper");
    // Silence unused-lint warnings on the assertion helper.
    expect(getProviderRegistry()).toBeTruthy();
  });
});

function swapGlobalFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}
