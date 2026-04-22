import { describe, expect, it, vi } from "vitest";
import {
  WhisperTranscriptionError,
  WhisperTranscriptionProvider,
} from "./provider.js";

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status: number, body = "upstream error"): Response {
  return new Response(body, { status });
}

function sampleAudio(): Uint8Array {
  return new Uint8Array([0x1, 0x2, 0x3, 0x4]);
}

function baseOptions(overrides: Partial<ConstructorParameters<typeof WhisperTranscriptionProvider>[0]> = {}) {
  return {
    apiKey: "sk-test",
    baseUrl: "https://api.example.com/v1",
    model: "whisper-1",
    timeoutMs: 5_000,
    maxRetries: 0,
    retryBaseDelayMs: 1,
    sleep: () => Promise.resolve(),
    fetchImpl: vi.fn().mockResolvedValue(okJson({ text: "hi", language: "en" })),
    ...overrides,
  };
}

describe("WhisperTranscriptionProvider", () => {
  it("posts audio to the configured base URL with bearer auth and parsed result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ text: "hello world", language: "en" }));
    const provider = new WhisperTranscriptionProvider(baseOptions({ fetchImpl }));

    const result = await provider.transcribe({
      audio: sampleAudio(),
      mimeType: "audio/ogg",
      languageHint: "en",
    });

    expect(result).toEqual({ text: "hello world", language: "en" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");

    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("en");
    expect(form.get("response_format")).toBe("verbose_json");
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
  });

  it("omits language field when no hint is provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ text: "text" }));
    const provider = new WhisperTranscriptionProvider(baseOptions({ fetchImpl }));

    await provider.transcribe({ audio: sampleAudio(), mimeType: "audio/ogg" });

    const form = fetchImpl.mock.calls[0][1].body as FormData;
    expect(form.get("language")).toBeNull();
  });

  it("derives a filename with the correct extension when caller omits one", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ text: "text" }));
    const provider = new WhisperTranscriptionProvider(baseOptions({ fetchImpl }));

    await provider.transcribe({ audio: sampleAudio(), mimeType: "audio/mp4" });

    const form = fetchImpl.mock.calls[0][1].body as FormData;
    const file = form.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("audio.m4a");
  });

  it("preserves caller-provided filename with extension", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ text: "text" }));
    const provider = new WhisperTranscriptionProvider(baseOptions({ fetchImpl }));

    await provider.transcribe({
      audio: sampleAudio(),
      mimeType: "audio/ogg",
      filename: "voice-note.ogg",
    });

    const form = fetchImpl.mock.calls[0][1].body as FormData;
    expect((form.get("file") as File).name).toBe("voice-note.ogg");
  });

  it("throws WhisperTranscriptionError with status on non-transient upstream failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errorResponse(401, "invalid api key"));
    const provider = new WhisperTranscriptionProvider(baseOptions({ fetchImpl }));

    const err = await provider
      .transcribe({ audio: sampleAudio(), mimeType: "audio/ogg" })
      .then(() => null)
      .catch((e) => e);
    expect(err).toBeInstanceOf(WhisperTranscriptionError);
    expect((err as WhisperTranscriptionError).status).toBe(401);
    expect((err as WhisperTranscriptionError).message).toContain("invalid api key");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on transient 5xx and returns success when later attempt succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(503, "busy"))
      .mockResolvedValueOnce(okJson({ text: "retry ok" }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const provider = new WhisperTranscriptionProvider(
      baseOptions({ fetchImpl, sleep, maxRetries: 2 }),
    );

    const result = await provider.transcribe({ audio: sampleAudio(), mimeType: "audio/ogg" });
    expect(result.text).toBe("retry ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries on persistent transient failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errorResponse(502, "upstream"));
    const provider = new WhisperTranscriptionProvider(
      baseOptions({ fetchImpl, maxRetries: 2 }),
    );

    await expect(
      provider.transcribe({ audio: sampleAudio(), mimeType: "audio/ogg" }),
    ).rejects.toBeInstanceOf(WhisperTranscriptionError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("wraps network errors into WhisperTranscriptionError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const provider = new WhisperTranscriptionProvider(baseOptions({ fetchImpl }));

    await expect(
      provider.transcribe({ audio: sampleAudio(), mimeType: "audio/ogg" }),
    ).rejects.toMatchObject({
      name: "WhisperTranscriptionError",
      message: expect.stringContaining("ECONNRESET"),
    });
  });

  it("surfaces abort errors as a timeout message", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });
    const provider = new WhisperTranscriptionProvider(baseOptions({ fetchImpl }));

    await expect(
      provider.transcribe({ audio: sampleAudio(), mimeType: "audio/ogg" }),
    ).rejects.toMatchObject({
      name: "WhisperTranscriptionError",
      message: expect.stringContaining("timed out"),
    });
  });

  it("rejects when response body is missing the text field", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ language: "en" }));
    const provider = new WhisperTranscriptionProvider(baseOptions({ fetchImpl }));

    await expect(
      provider.transcribe({ audio: sampleAudio(), mimeType: "audio/ogg" }),
    ).rejects.toMatchObject({ message: expect.stringContaining("missing text") });
  });
});
