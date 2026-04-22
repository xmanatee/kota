import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import {
  getTranscriptionProvider,
  TRANSCRIPTION_PROVIDER_TYPE,
  type TranscriptionProvider,
  TranscriptionProviderUnavailableError,
  transcribeAudio,
} from "./index.js";

const sampleAudio = new Uint8Array([0x00, 0x01, 0x02]);

function makeStubProvider(overrides: Partial<TranscriptionProvider> = {}): TranscriptionProvider {
  return {
    name: "stub",
    async transcribe(input) {
      return { text: `stub:${input.mimeType}:${input.audio.length}` };
    },
    ...overrides,
  };
}

describe("transcription service", () => {
  beforeEach(() => {
    resetProviderRegistry();
  });

  afterEach(() => {
    resetProviderRegistry();
  });

  it("throws TranscriptionProviderUnavailableError when no registry exists", () => {
    expect(() => getTranscriptionProvider()).toThrow(TranscriptionProviderUnavailableError);
  });

  it("throws TranscriptionProviderUnavailableError when registry has no provider", () => {
    initProviderRegistry();
    expect(() => getTranscriptionProvider()).toThrow(TranscriptionProviderUnavailableError);
  });

  it("returns the active provider when one is registered", async () => {
    const registry = initProviderRegistry();
    const provider = makeStubProvider();
    registry.register(TRANSCRIPTION_PROVIDER_TYPE, provider.name, provider);

    const resolved = getTranscriptionProvider();
    expect(resolved.name).toBe("stub");

    const result = await transcribeAudio({
      audio: sampleAudio,
      mimeType: "audio/ogg",
    });
    expect(result.text).toBe("stub:audio/ogg:3");
  });

  it("respects active provider selection when multiple are registered", async () => {
    const registry = initProviderRegistry();
    const first = makeStubProvider({ name: "first" });
    const second = makeStubProvider({
      name: "second",
      async transcribe() {
        return { text: "from-second" };
      },
    });
    registry.register(TRANSCRIPTION_PROVIDER_TYPE, first.name, first);
    registry.register(TRANSCRIPTION_PROVIDER_TYPE, second.name, second);

    expect(getTranscriptionProvider().name).toBe("first");

    registry.setActive(TRANSCRIPTION_PROVIDER_TYPE, "second");

    const result = await transcribeAudio({
      audio: sampleAudio,
      mimeType: "audio/ogg",
    });
    expect(result.text).toBe("from-second");
  });

  it("propagates provider errors unchanged", async () => {
    const registry = initProviderRegistry();
    const provider = makeStubProvider({
      async transcribe() {
        throw new Error("upstream boom");
      },
    });
    registry.register(TRANSCRIPTION_PROVIDER_TYPE, provider.name, provider);

    await expect(
      transcribeAudio({ audio: sampleAudio, mimeType: "audio/ogg" }),
    ).rejects.toThrow("upstream boom");
  });
});
