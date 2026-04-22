import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { TRANSCRIPTION_PROVIDER_TYPE } from "#modules/transcription/types.js";
import {
  SPEECH_SYNTHESIS_PROVIDER_TYPE,
  SpeechSynthesisFormatError,
  type SpeechSynthesisProvider,
  SpeechSynthesisProviderUnavailableError,
  type SpeechToTextProvider,
  SpeechToTextProviderUnavailableError,
  synthesizeSpeech,
  transcribeVoice,
} from "./index.js";

function makeStubStt(): SpeechToTextProvider {
  return {
    name: "stub-stt",
    async transcribe(input) {
      return { text: `stt:${input.mimeType}:${input.audio.length}`, language: "en" };
    },
  };
}

function makeStubTts(overrides: Partial<SpeechSynthesisProvider> = {}): SpeechSynthesisProvider {
  return {
    name: "stub-tts",
    supportedFormats: ["mp3", "wav"],
    async synthesize(input) {
      return {
        audio: new Uint8Array([1, 2, 3, input.text.length]),
        mimeType: "audio/mpeg",
        format: input.format ?? "mp3",
      };
    },
    ...overrides,
  };
}

describe("voice service", () => {
  beforeEach(() => {
    resetProviderRegistry();
  });

  afterEach(() => {
    resetProviderRegistry();
  });

  describe("transcribeVoice", () => {
    it("throws SpeechToTextProviderUnavailableError when no STT provider is registered", async () => {
      initProviderRegistry();
      await expect(
        transcribeVoice({ audio: new Uint8Array([0]), mimeType: "audio/ogg" }),
      ).rejects.toBeInstanceOf(SpeechToTextProviderUnavailableError);
    });

    it("delegates to the registered STT provider", async () => {
      const registry = initProviderRegistry();
      registry.register(TRANSCRIPTION_PROVIDER_TYPE, "stub-stt", makeStubStt());
      const result = await transcribeVoice({
        audio: new Uint8Array([1, 2, 3]),
        mimeType: "audio/ogg",
      });
      expect(result).toEqual({ text: "stt:audio/ogg:3", language: "en" });
    });

    it("propagates provider errors unchanged", async () => {
      const registry = initProviderRegistry();
      registry.register(TRANSCRIPTION_PROVIDER_TYPE, "boom", {
        name: "boom",
        async transcribe() {
          throw new Error("upstream boom");
        },
      } satisfies SpeechToTextProvider);
      await expect(
        transcribeVoice({ audio: new Uint8Array([0]), mimeType: "audio/ogg" }),
      ).rejects.toThrow("upstream boom");
    });
  });

  describe("synthesizeSpeech", () => {
    it("throws SpeechSynthesisProviderUnavailableError when no TTS provider is registered", async () => {
      initProviderRegistry();
      await expect(synthesizeSpeech({ text: "hi" })).rejects.toBeInstanceOf(
        SpeechSynthesisProviderUnavailableError,
      );
    });

    it("rejects empty text before touching a provider", async () => {
      initProviderRegistry();
      await expect(synthesizeSpeech({ text: "   " })).rejects.toThrow(/text is empty/);
    });

    it("delegates to the registered TTS provider", async () => {
      const registry = initProviderRegistry();
      registry.register(SPEECH_SYNTHESIS_PROVIDER_TYPE, "stub-tts", makeStubTts());
      const result = await synthesizeSpeech({ text: "hello", format: "mp3" });
      expect(result.mimeType).toBe("audio/mpeg");
      expect(result.format).toBe("mp3");
      expect(result.audio.byteLength).toBeGreaterThan(0);
    });

    it("throws SpeechSynthesisFormatError when requested format is not supported", async () => {
      const registry = initProviderRegistry();
      registry.register(SPEECH_SYNTHESIS_PROVIDER_TYPE, "stub-tts", makeStubTts());
      await expect(
        synthesizeSpeech({ text: "hi", format: "flac" }),
      ).rejects.toBeInstanceOf(SpeechSynthesisFormatError);
    });

    it("respects active provider selection when multiple are registered", async () => {
      const registry = initProviderRegistry();
      registry.register(SPEECH_SYNTHESIS_PROVIDER_TYPE, "first", makeStubTts());
      registry.register(SPEECH_SYNTHESIS_PROVIDER_TYPE, "second", makeStubTts({
        name: "second",
        supportedFormats: ["opus"],
        async synthesize() {
          return { audio: new Uint8Array([9]), mimeType: "audio/ogg", format: "opus" };
        },
      }));
      registry.setActive(SPEECH_SYNTHESIS_PROVIDER_TYPE, "second");
      const result = await synthesizeSpeech({ text: "hi" });
      expect(result.format).toBe("opus");
    });
  });
});
