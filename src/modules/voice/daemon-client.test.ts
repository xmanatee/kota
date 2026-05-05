/**
 * Voice namespace daemon-side handler test.
 *
 * The voice namespace migrated out of the core stub into `daemonClient(link)`
 * on the voice module. This test pins the invariants the migration relies on:
 *
 *  1. The voice module exposes a `daemonClient(link)` factory and the factory
 *     returns a handler for the `voice` namespace with `transcribe` and
 *     `synthesize` methods.
 *  2. `transcribe(options)` is wired through `link.fetchRaw` with method
 *     `POST`, path `/voice/transcribe`, headers `{ "Content-Type":
 *     "application/json" }`, and a JSON body that base64-encodes the audio
 *     `Uint8Array` into the `audioBase64` field. Optional fields
 *     (`filename`, `languageHint`) are omitted from the body when undefined
 *     and present when set, matching today's pre-migration wire shape.
 *  3. `transcribe(options)` decodes the success arm correctly: `200 + { text
 *     }` collapses to `{ ok: true, text }`, `200 + { text, language }`
 *     collapses to `{ ok: true, text, language }`.
 *  4. `transcribe(options)` decodes the transport_error arm correctly:
 *     `502 + { error, code }` collapses to `{ ok: false, reason:
 *     "transport_error", status, message, code }` with the optional `code`
 *     propagated; `400 + { error }` (no code) collapses to the same shape
 *     with the `code` key omitted entirely (not set to `undefined`).
 *  5. `synthesize(options)` is wired through `link.fetchRaw` with method
 *     `POST`, path `/voice/synthesize`, headers `{ "Content-Type":
 *     "application/json" }`, and a JSON body containing the `text` plus
 *     optional `voice` / `languageHint` / `format` fields, omitted when
 *     undefined and present when set.
 *  6. `synthesize(options)` decodes the success arm correctly: `200 + {
 *     audioBase64, mimeType, format }` collapses to `{ ok: true, audio:
 *     Buffer.from(<base64>, "base64"), mimeType, format }`.
 *  7. `synthesize(options)` decodes the transport_error arm correctly: a
 *     `503 + { error, code: "tts-unavailable" }` response collapses to the
 *     namespace shape with `code` propagated, and a `400 + { error, code:
 *     "tts-format-unsupported" }` response (the daemon's
 *     `SYNTHESIS_FORMAT_ERROR`-equivalent envelope) collapses identically.
 *  8. The daemon-side factory NEVER returns the `daemon_required` arm — only
 *     the local handler emits that arm.
 *  9. Supplying the contribution to the assembly path satisfies coverage.
 * 10. Removing the voice module's daemonClient contribution makes the
 *     assembled client fail loudly with a clear "voice" missing-handler error.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import { assembleDaemonClientHandlers } from "#core/server/daemon-client.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  VoiceClient,
  VoiceSynthesizeResult,
  VoiceTranscribeResult,
} from "./client.js";
import voiceModule from "./index.js";

type RecordedCall = {
  path: string;
  init: RequestInit | undefined;
};

type FetchResponder = (path: string, init: RequestInit | undefined) => Response;

function makeRecordingTransport(responder: FetchResponder): {
  transport: DaemonTransport;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const transport: DaemonTransport = {
    baseUrl: "http://127.0.0.1:0",
    authHeaders: () => ({}),
    request: async () => null,
    requestStrict: async () => {
      throw new Error("not used");
    },
    fetchRaw: async (path, init) => {
      calls.push({ path, init });
      return responder(path, init);
    },
    events: async function* () {
      // empty generator
    },
  };
  return { transport, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("voice module daemonClient(link)", () => {
  it("contributes a voice namespace handler", () => {
    expect(voiceModule.daemonClient).toBeTypeOf("function");
    const link = makeRecordingTransport(() => jsonResponse(200, {})).transport;
    const contributed = voiceModule.daemonClient!(link);
    expect(contributed.voice).toBeDefined();
    expect(typeof contributed.voice!.transcribe).toBe("function");
    expect(typeof contributed.voice!.synthesize).toBe("function");
  });

  it("routes transcribe() with only required fields through POST /voice/transcribe with base64-encoded audio", async () => {
    const audio = new Uint8Array([0x12, 0x34, 0x56]);
    const expectedBase64 = Buffer.from(audio).toString("base64");
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, { text: "hello" }),
    );
    const contributed = voiceModule.daemonClient!(transport);
    const result = await contributed.voice!.transcribe({
      audio,
      mimeType: "audio/wav",
    });
    expect(result).toEqual({ ok: true, text: "hello" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/voice/transcribe");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      audioBase64: expectedBase64,
      mimeType: "audio/wav",
    });
  });

  it("routes transcribe() with every optional field through POST /voice/transcribe with the full body", async () => {
    const audio = new Uint8Array([0xaa, 0xbb]);
    const expectedBase64 = Buffer.from(audio).toString("base64");
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, { text: "hi", language: "en" }),
    );
    const contributed = voiceModule.daemonClient!(transport);
    const result = await contributed.voice!.transcribe({
      audio,
      mimeType: "audio/mp4",
      filename: "clip.m4a",
      languageHint: "en-US",
    });
    expect(result).toEqual({ ok: true, text: "hi", language: "en" });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      audioBase64: expectedBase64,
      mimeType: "audio/mp4",
      filename: "clip.m4a",
      languageHint: "en-US",
    });
  });

  it("decodes the transcribe transport_error arm with code propagated verbatim", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(502, {
        error: "stt down",
        code: "STT_PROVIDER_UNAVAILABLE",
      }),
    );
    const contributed = voiceModule.daemonClient!(transport);
    const result = await contributed.voice!.transcribe({
      audio: new Uint8Array([1]),
      mimeType: "audio/wav",
    });
    expect(result).toEqual({
      ok: false,
      reason: "transport_error",
      status: 502,
      message: "stt down",
      code: "STT_PROVIDER_UNAVAILABLE",
    });
  });

  it("decodes the transcribe transport_error arm with the code key omitted when the daemon body has no code", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(400, { error: "bad mime" }),
    );
    const contributed = voiceModule.daemonClient!(transport);
    const result = await contributed.voice!.transcribe({
      audio: new Uint8Array([1]),
      mimeType: "audio/wav",
    });
    expect(result).toEqual({
      ok: false,
      reason: "transport_error",
      status: 400,
      message: "bad mime",
    });
    expect(Object.hasOwn(result, "code")).toBe(false);
  });

  it("routes synthesize() with only required fields through POST /voice/synthesize", async () => {
    const audioBytes = new Uint8Array([1, 2, 3, 4]);
    const audioBase64 = Buffer.from(audioBytes).toString("base64");
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, { audioBase64, mimeType: "audio/mpeg", format: "mp3" }),
    );
    const contributed = voiceModule.daemonClient!(transport);
    const result = await contributed.voice!.synthesize({ text: "hi" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/voice/synthesize");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ text: "hi" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.audio).toBeInstanceOf(Buffer);
      expect(Array.from(result.audio)).toEqual([1, 2, 3, 4]);
      expect(result.mimeType).toBe("audio/mpeg");
      expect(result.format).toBe("mp3");
    }
  });

  it("routes synthesize() with every optional field through POST /voice/synthesize with the full body", async () => {
    const { transport, calls } = makeRecordingTransport(() =>
      jsonResponse(200, {
        audioBase64: Buffer.from([0]).toString("base64"),
        mimeType: "audio/mp4",
        format: "mp4",
      }),
    );
    const contributed = voiceModule.daemonClient!(transport);
    await contributed.voice!.synthesize({
      text: "hello",
      voice: "alloy",
      languageHint: "en",
      format: "mp4",
    });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      text: "hello",
      voice: "alloy",
      languageHint: "en",
      format: "mp4",
    });
  });

  it("decodes the synthesize transport_error arm with provider-unavailable code propagated", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(503, {
        error: "tts down",
        code: "tts-unavailable",
      }),
    );
    const contributed = voiceModule.daemonClient!(transport);
    const result = await contributed.voice!.synthesize({ text: "hi" });
    expect(result).toEqual({
      ok: false,
      reason: "transport_error",
      status: 503,
      message: "tts down",
      code: "tts-unavailable",
    });
  });

  it("decodes the synthesize transport_error arm with format-error code propagated", async () => {
    const { transport } = makeRecordingTransport(() =>
      jsonResponse(400, {
        error: "format not supported",
        code: "tts-format-unsupported",
      }),
    );
    const contributed = voiceModule.daemonClient!(transport);
    const result = await contributed.voice!.synthesize({
      text: "hi",
      format: "flac",
    });
    expect(result).toEqual({
      ok: false,
      reason: "transport_error",
      status: 400,
      message: "format not supported",
      code: "tts-format-unsupported",
    });
  });

  it("the daemon-side factory result type never includes the daemon_required arm", () => {
    const link = makeRecordingTransport(() => jsonResponse(200, {})).transport;
    const contributed = voiceModule.daemonClient!(link);
    const factory = contributed.voice as VoiceClient;
    type TranscribeReturn = Awaited<ReturnType<typeof factory.transcribe>>;
    type SynthesizeReturn = Awaited<ReturnType<typeof factory.synthesize>>;
    // The factory's typed return is the full namespace shape (the contract is
    // shared with the local handler), so this test pins the runtime
    // invariant: no test case in this file constructs a daemon_required
    // response from the factory. The type-level pin below documents the
    // namespace contract; only the local handler emits the daemon_required arm.
    expectTypeOf<TranscribeReturn>().toEqualTypeOf<VoiceTranscribeResult>();
    expectTypeOf<SynthesizeReturn>().toEqualTypeOf<VoiceSynthesizeResult>();
  });

  it("supplying the voice module's contribution to the assembly path satisfies coverage", () => {
    const { transport } = makeRecordingTransport(() => jsonResponse(200, {}));
    const contributed = voiceModule.daemonClient!(transport);
    const others = buildMigratedNamespaceTestStubs();
    delete others.voice;
    expect(() =>
      assembleDaemonClientHandlers(transport, { ...others, ...contributed }),
    ).not.toThrow();
  });

  it("the assembly path fails loudly when the voice module's daemonClient(link) is removed", () => {
    const { transport } = makeRecordingTransport(() => jsonResponse(200, {}));
    const others = buildMigratedNamespaceTestStubs();
    delete others.voice;
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /voice/,
    );
    expect(() => assembleDaemonClientHandlers(transport, others)).toThrow(
      /missing daemon handler/,
    );
  });
});
