import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { TRANSCRIPTION_PROVIDER_TYPE } from "#modules/transcription/types.js";
import {
  SPEECH_SYNTHESIS_PROVIDER_TYPE,
  type SpeechSynthesisProvider,
  type SpeechToTextProvider,
} from "#modules/voice/types.js";
import {
  handleVoiceSynthesize,
  handleVoiceTranscribe,
} from "./daemon-control-voice.js";

type CapturedResponse = {
  statusCode: number;
  body: Record<string, unknown>;
};

function makeRequest(bodyJson: unknown): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage & EventEmitter;
  queueMicrotask(() => {
    if (bodyJson !== undefined) {
      emitter.emit("data", Buffer.from(JSON.stringify(bodyJson)));
    }
    emitter.emit("end");
  });
  return emitter;
}

function makeResponse(captured: CapturedResponse): ServerResponse {
  const chunks: string[] = [];
  let headersSent = false;
  const res = {
    get headersSent() {
      return headersSent;
    },
    writeHead(status: number) {
      captured.statusCode = status;
      headersSent = true;
    },
    end(chunk?: string) {
      if (chunk) chunks.push(chunk);
      captured.body = JSON.parse(chunks.join("")) as Record<string, unknown>;
    },
    setHeader() {},
  } as unknown as ServerResponse;
  return res;
}

async function runHandler(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  body: unknown,
): Promise<CapturedResponse> {
  const captured: CapturedResponse = { statusCode: 0, body: {} };
  const req = makeRequest(body);
  const res = makeResponse(captured);
  await handler(req, res);
  return captured;
}

describe("daemon-control voice routes", () => {
  beforeEach(() => {
    resetProviderRegistry();
  });
  afterEach(() => {
    resetProviderRegistry();
  });

  describe("/voice/transcribe", () => {
    it("returns text and language when an STT provider succeeds", async () => {
      const registry = initProviderRegistry();
      const provider: SpeechToTextProvider = {
        name: "stub-stt",
        async transcribe(input) {
          return { text: `heard:${input.mimeType}:${input.audio.length}`, language: "en" };
        },
      };
      registry.register(TRANSCRIPTION_PROVIDER_TYPE, provider.name, provider);
      const result = await runHandler(handleVoiceTranscribe, {
        audioBase64: Buffer.from([1, 2, 3]).toString("base64"),
        mimeType: "audio/wav",
      });
      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual({ text: "heard:audio/wav:3", language: "en" });
    });

    it("returns 503 with stt-unavailable code when no STT provider is registered", async () => {
      initProviderRegistry();
      const result = await runHandler(handleVoiceTranscribe, {
        audioBase64: Buffer.from([1]).toString("base64"),
        mimeType: "audio/wav",
      });
      expect(result.statusCode).toBe(503);
      expect(result.body.code).toBe("stt-unavailable");
    });

    it("returns 400 when body is missing required fields", async () => {
      initProviderRegistry();
      const result = await runHandler(handleVoiceTranscribe, { foo: "bar" });
      expect(result.statusCode).toBe(400);
      expect(result.body.error).toMatch(/required/);
    });

    it("returns 400 when the body is empty", async () => {
      initProviderRegistry();
      const result = await runHandler(handleVoiceTranscribe, undefined);
      expect(result.statusCode).toBe(400);
    });

    it("returns 502 when the provider throws a non-unavailable error", async () => {
      const registry = initProviderRegistry();
      registry.register(TRANSCRIPTION_PROVIDER_TYPE, "boom", {
        name: "boom",
        async transcribe() {
          throw new Error("upstream 500");
        },
      } satisfies SpeechToTextProvider);
      const result = await runHandler(handleVoiceTranscribe, {
        audioBase64: Buffer.from([1]).toString("base64"),
        mimeType: "audio/wav",
      });
      expect(result.statusCode).toBe(502);
      expect(result.body.code).toBe("stt-failed");
    });
  });

  describe("/voice/synthesize", () => {
    function makeTts(): SpeechSynthesisProvider {
      return {
        name: "stub-tts",
        supportedFormats: ["mp3", "wav"],
        async synthesize(input) {
          return {
            audio: new Uint8Array([10, 20, 30, input.text.length]),
            mimeType: "audio/mpeg",
            format: input.format ?? "mp3",
          };
        },
      };
    }

    it("returns base64 audio when a TTS provider succeeds", async () => {
      const registry = initProviderRegistry();
      registry.register(SPEECH_SYNTHESIS_PROVIDER_TYPE, "stub-tts", makeTts());
      const result = await runHandler(handleVoiceSynthesize, {
        text: "round-trip",
        format: "mp3",
      });
      expect(result.statusCode).toBe(200);
      expect(result.body.mimeType).toBe("audio/mpeg");
      expect(result.body.format).toBe("mp3");
      const decoded = Buffer.from(String(result.body.audioBase64), "base64");
      expect(Array.from(decoded)).toEqual([10, 20, 30, "round-trip".length]);
    });

    it("returns 503 with tts-unavailable code when no TTS provider is registered", async () => {
      initProviderRegistry();
      const result = await runHandler(handleVoiceSynthesize, { text: "hi" });
      expect(result.statusCode).toBe(503);
      expect(result.body.code).toBe("tts-unavailable");
    });

    it("returns 400 tts-format-unsupported when provider does not support the requested format", async () => {
      const registry = initProviderRegistry();
      registry.register(SPEECH_SYNTHESIS_PROVIDER_TYPE, "stub-tts", makeTts());
      const result = await runHandler(handleVoiceSynthesize, { text: "hi", format: "flac" });
      expect(result.statusCode).toBe(400);
      expect(result.body.code).toBe("tts-format-unsupported");
      expect(result.body.supported).toEqual(["mp3", "wav"]);
    });

    it("returns 400 when text is empty", async () => {
      initProviderRegistry();
      const result = await runHandler(handleVoiceSynthesize, { text: "  " });
      expect(result.statusCode).toBe(400);
    });

    it("returns 400 when format is not a known enum value", async () => {
      const registry = initProviderRegistry();
      registry.register(SPEECH_SYNTHESIS_PROVIDER_TYPE, "stub-tts", makeTts());
      const result = await runHandler(handleVoiceSynthesize, { text: "hi", format: "weird" });
      expect(result.statusCode).toBe(400);
    });
  });
});
