import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BufferTransport } from "#core/loop/transport.js";
import { type StreamConfig, streamMessage } from "./streaming.js";

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

function createStream(texts: string[] = ["Hello"]) {
  return {
    on: vi.fn().mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === "text") texts.forEach((t) => cb(t));
    }),
    finalMessage: vi.fn().mockResolvedValue({
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: texts.join("") }],
      model: "test-model",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  };
}

function cfg(client: unknown): StreamConfig {
  return {
    client: client as StreamConfig["client"],
    model: "test-model",
    maxTokens: 1024,
    system: [{ type: "text", text: "test" }],
    messages: [{ role: "user", content: "Hello" }],
    tools: [],
    transport: new BufferTransport(),
  };
}

describe("streamMessage", () => {
  it("returns response and accumulated text on success", async () => {
    const s = createStream(["Hello", " world"]);
    const client = { messages: { stream: vi.fn().mockReturnValue(s) } };

    const result = await streamMessage(cfg(client));

    expect(result.streamedText).toBe("Hello world");
    expect(result.response.stop_reason).toBe("end_turn");
    expect(client.messages.stream).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error and succeeds", async () => {
    const s = createStream(["OK"]);
    const client = {
      messages: {
        stream: vi.fn()
          .mockImplementationOnce(() => { throw new Error("ECONNRESET"); })
          .mockReturnValueOnce(s),
      },
    };

    const promise = streamMessage(cfg(client));
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;

    expect(result.streamedText).toBe("OK");
    expect(client.messages.stream).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 rate limit", async () => {
    const s = createStream(["OK"]);
    const err = Object.assign(new Error("Rate limited"), { status: 429 });
    const client = {
      messages: {
        stream: vi.fn()
          .mockImplementationOnce(() => { throw err; })
          .mockReturnValueOnce(s),
      },
    };

    const promise = streamMessage(cfg(client));
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;

    expect(result.streamedText).toBe("OK");
    expect(client.messages.stream).toHaveBeenCalledTimes(2);
  });

  it("retries on 5xx server error", async () => {
    const s = createStream(["OK"]);
    const err = Object.assign(new Error("Internal Server Error"), { status: 500 });
    const client = {
      messages: {
        stream: vi.fn()
          .mockImplementationOnce(() => { throw err; })
          .mockReturnValueOnce(s),
      },
    };

    const promise = streamMessage(cfg(client));
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;

    expect(result.streamedText).toBe("OK");
  });

  it("gives up after max retries", async () => {
    const client = {
      messages: { stream: vi.fn().mockImplementation(() => { throw new Error("server error"); }) },
    };

    const promise = streamMessage(cfg(client));
    const assertion = expect(promise).rejects.toThrow("server error");
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(client.messages.stream).toHaveBeenCalledTimes(4);
  });

  it("does not retry on auth errors", async () => {
    for (const msg of ["authentication failed", "invalid apiKey", "bad authToken"]) {
      const client = {
        messages: { stream: vi.fn().mockImplementation(() => { throw new Error(msg); }) },
      };
      await expect(streamMessage(cfg(client))).rejects.toThrow(msg);
      expect(client.messages.stream).toHaveBeenCalledTimes(1);
    }
  });

  it("does not retry on 4xx client errors", async () => {
    const err = Object.assign(new Error("Bad Request"), { status: 400 });
    const client = {
      messages: { stream: vi.fn().mockImplementation(() => { throw err; }) },
    };

    await expect(streamMessage(cfg(client))).rejects.toThrow("Bad Request");
    expect(client.messages.stream).toHaveBeenCalledTimes(1);
  });

  it("retries on mid-stream failure (finalMessage rejects after text emitted)", async () => {
    const failingStream = {
      on: vi.fn().mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === "text") cb("partial");
      }),
      finalMessage: vi.fn().mockRejectedValue(new Error("stream interrupted")),
    };
    const successStream = createStream(["OK"]);
    const client = {
      messages: {
        stream: vi.fn()
          .mockReturnValueOnce(failingStream)
          .mockReturnValueOnce(successStream),
      },
    };

    const promise = streamMessage(cfg(client));
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;

    expect(result.streamedText).toBe("OK");
    expect(client.messages.stream).toHaveBeenCalledTimes(2);
  });

  it("mid-stream retry resets accumulated text (no duplication in result)", async () => {
    const failStream = {
      on: vi.fn().mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === "text") { cb("partial data "); cb("more "); }
      }),
      finalMessage: vi.fn().mockRejectedValue(new Error("connection reset")),
    };
    const okStream = createStream(["final result"]);
    const client = {
      messages: {
        stream: vi.fn()
          .mockReturnValueOnce(failStream)
          .mockReturnValueOnce(okStream),
      },
    };

    const promise = streamMessage(cfg(client));
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await promise;

    expect(result.streamedText).toBe("final result");
    expect(result.streamedText).not.toContain("partial");
  });

  it("emits a thinking_start event and every thinking chunk when thinking is enabled", async () => {
    const s = {
      on: vi.fn().mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === "thinking") { cb("step 1..."); cb("step 2..."); }
        if (event === "text") cb("answer");
      }),
      finalMessage: vi.fn().mockResolvedValue({
        id: "msg_t", type: "message", role: "assistant",
        content: [{ type: "text", text: "answer" }],
        model: "test-model", stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    };
    const client = { messages: { stream: vi.fn().mockReturnValue(s) } };
    const transport = new BufferTransport();
    const config = {
      ...cfg(client),
      thinkingConfig: { type: "enabled" as const, budget_tokens: 1000 },
      transport,
    };

    await streamMessage(config);

    const thinkingStarts = transport.events.filter((e) => e.type === "thinking_start");
    const thinkingChunks = transport.events
      .filter((e): e is Extract<typeof e, { type: "thinking" }> => e.type === "thinking")
      .map((e) => e.content);
    expect(thinkingStarts).toHaveLength(1);
    expect(thinkingChunks).toEqual(["step 1...", "step 2..."]);
  });
});
