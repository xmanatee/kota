import { describe, expect, it, vi } from "vitest";
import { OpenAiTtsError, OpenAiTtsProvider, type OpenAiTtsProviderOptions } from "./provider.js";

function makeProvider(
  fetchImpl: typeof fetch,
  overrides: Partial<OpenAiTtsProviderOptions> = {},
): OpenAiTtsProvider {
  return new OpenAiTtsProvider({
    apiKey: "sk-test",
    baseUrl: "https://api.openai.test/v1",
    model: "tts-1",
    defaultVoice: "alloy",
    defaultFormat: "mp3",
    timeoutMs: 5000,
    maxRetries: 0,
    retryBaseDelayMs: 1,
    fetchImpl,
    sleep: async () => {},
    ...overrides,
  });
}

describe("OpenAiTtsProvider", () => {
  it("posts JSON and returns audio bytes with matching mime type", async () => {
    const audioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(audioBytes, { status: 200 }),
    );
    const provider = makeProvider(fetchImpl);
    const result = await provider.synthesize({ text: "hello world", format: "mp3" });
    expect(result.format).toBe("mp3");
    expect(result.mimeType).toBe("audio/mpeg");
    expect(Array.from(result.audio)).toEqual([0xff, 0xfb, 0x90, 0x00]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0]!;
    expect(call[0]).toBe("https://api.openai.test/v1/audio/speech");
    const init = call[1]! as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("tts-1");
    expect(body.response_format).toBe("mp3");
    expect(body.input).toBe("hello world");
  });

  it("uses default voice and format when caller does not override", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([1]), { status: 200 }),
    );
    const provider = makeProvider(fetchImpl, { defaultVoice: "nova" });
    await provider.synthesize({ text: "abc" });
    const body = JSON.parse(String((fetchImpl.mock.calls[0]![1] as RequestInit).body));
    expect(body.voice).toBe("nova");
    expect(body.response_format).toBe("mp3");
  });

  it("retries on transient 5xx errors up to maxRetries then throws", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("boom", { status: 503 }))
      .mockResolvedValueOnce(new Response("boom", { status: 503 }));
    const provider = makeProvider(fetchImpl, { maxRetries: 1 });
    await expect(provider.synthesize({ text: "hi" })).rejects.toBeInstanceOf(OpenAiTtsError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 4xx errors", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("bad key", { status: 401 }));
    const provider = makeProvider(fetchImpl, { maxRetries: 5 });
    await expect(provider.synthesize({ text: "hi" })).rejects.toMatchObject({
      name: "OpenAiTtsError",
      status: 401,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws for unsupported requested formats before calling the API", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = makeProvider(fetchImpl);
    await expect(
      provider.synthesize({ text: "hi", format: "ogg" }),
    ).rejects.toBeInstanceOf(OpenAiTtsError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("declares its supported formats", () => {
    const provider = makeProvider(vi.fn());
    expect(provider.supportedFormats).toEqual(["mp3", "opus", "aac", "flac", "wav", "pcm"]);
  });
});
