/**
 * Voice client tests — round-trip and failure mode for both /api/voice
 * directions, hitting a fake fetch the same way client.test.ts does.
 *
 * The codes asserted here (`stt-unavailable`, `tts-format-unsupported`)
 * mirror the server's documented vocabulary so any drift between the
 * voice module and the web client surfaces as a test failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("api voice", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "location", {
      value: { search: "", pathname: "/", hash: "" },
      writable: true,
    });
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it("voiceTranscribe POSTs base64 audio and parses a successful response", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ text: "hello world", language: "en" }),
    });

    const { api } = await import("./client");
    const audio = new Blob([new Uint8Array([1, 2, 3, 4, 5])], {
      type: "audio/webm",
    });
    const result = await api.voiceTranscribe({
      audio,
      mimeType: "audio/webm",
      filename: "clip.webm",
    });

    expect(result).toEqual({ ok: true, text: "hello world", language: "en" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/voice/transcribe");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.mimeType).toBe("audio/webm");
    expect(body.filename).toBe("clip.webm");
    // base64 of [1,2,3,4,5]
    expect(body.audioBase64).toBe("AQIDBAU=");
  });

  it("voiceTranscribe surfaces the daemon's typed failure code on 503", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      json: () =>
        Promise.resolve({
          error: "No transcription provider is registered",
          code: "stt-unavailable",
        }),
    });

    const { api } = await import("./client");
    const audio = new Blob([new Uint8Array([1])], { type: "audio/webm" });
    const result = await api.voiceTranscribe({ audio, mimeType: "audio/webm" });

    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "No transcription provider is registered",
      code: "stt-unavailable",
    });
  });

  it("voiceSynthesize decodes returned audio bytes into a Blob", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          audioBase64: "CQgHBg==", // [9,8,7,6]
          mimeType: "audio/mpeg",
          format: "mp3",
        }),
    });

    const { api } = await import("./client");
    const result = await api.voiceSynthesize({ text: "speak me" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok response");
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.format).toBe("mp3");
    expect(result.audio).toBeInstanceOf(Blob);
    expect(result.audio.type).toBe("audio/mpeg");
    // CQgHBg== decodes to [9,8,7,6] — 4 bytes
    expect(result.audio.size).toBe(4);
  });

  it("voiceSynthesize surfaces tts-format-unsupported on 400", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: "Format flac not supported by provider",
          code: "tts-format-unsupported",
          supported: ["mp3", "wav"],
        }),
    });

    const { api } = await import("./client");
    const result = await api.voiceSynthesize({
      text: "speak me",
      format: "flac",
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Format flac not supported by provider",
      code: "tts-format-unsupported",
    });
  });
});
