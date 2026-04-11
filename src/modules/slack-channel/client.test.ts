import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callSlackApi,
  MAX_TEXT_LENGTH,
  openSocketModeUrl,
  SlackTransport,
  splitText,
} from "./client.js";

// --- Shared fetch mock helper ---

const originalFetch = globalThis.fetch;

function installFetchMock(defaultResponse?: unknown) {
  const mock = vi.fn();
  if (defaultResponse !== undefined) {
    mock.mockResolvedValue({ json: () => Promise.resolve(defaultResponse) });
  }
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// --- splitText ---

describe("splitText", () => {
  it("returns single chunk for short messages", () => {
    expect(splitText("hello")).toEqual(["hello"]);
  });

  it("returns single chunk at exact limit", () => {
    const text = "a".repeat(MAX_TEXT_LENGTH);
    expect(splitText(text)).toEqual([text]);
  });

  it("splits at newline boundary when possible", () => {
    const text = "line1\nline2\nline3";
    const chunks = splitText(text, 12);
    expect(chunks[0]).toBe("line1\nline2");
    expect(chunks[1]).toBe("line3");
  });

  it("hard splits when no newline found", () => {
    const text = "a".repeat(200);
    const chunks = splitText(text, 100);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe("a".repeat(100));
    expect(chunks[1]).toBe("a".repeat(100));
  });

  it("handles empty string", () => {
    expect(splitText("")).toEqual([""]);
  });

  it("splits long text into multiple chunks respecting limit", () => {
    const text = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const chunks = splitText(text, 20);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20);
    }
  });

  it("uses default max length of MAX_TEXT_LENGTH", () => {
    const shortText = "hello";
    expect(splitText(shortText)).toEqual([shortText]);
  });

  it("strips leading newline from remainder after split", () => {
    // When split happens at a newline, the leading \n on the remainder is stripped
    const text = "abc\ndef";
    const chunks = splitText(text, 4);
    // "abc\n" is 4 chars, lastIndexOf("\n", 4) = 3
    expect(chunks[0]).toBe("abc");
    expect(chunks[1]).toBe("def");
  });
});

// --- callSlackApi ---

describe("callSlackApi", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = installFetchMock();
  });

  afterEach(restoreFetch);

  it("calls correct URL with token and method", async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, user: { id: "U1" } }),
    });
    const result = await callSlackApi<{ user: { id: string } }>(
      "xoxb-token",
      "users.info",
      { user: "U1" },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/users.info",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer xoxb-token",
          "Content-Type": "application/json; charset=utf-8",
        }),
      }),
    );
    expect(result).toEqual(expect.objectContaining({ user: { id: "U1" } }));
  });

  it("sends body as JSON", async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    });
    await callSlackApi("tok", "chat.postMessage", { channel: "C1", text: "hi" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ channel: "C1", text: "hi" }),
      }),
    );
  });

  it("omits body when not provided", async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    });
    await callSlackApi("tok", "auth.test");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: undefined }),
    );
  });

  it("throws on API error response", async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: "invalid_auth" }),
    });
    await expect(callSlackApi("bad", "auth.test")).rejects.toThrow(
      "Slack API auth.test: invalid_auth",
    );
  });

  it("wraps network errors with method context", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(callSlackApi("tok", "chat.postMessage")).rejects.toThrow(
      "Slack API chat.postMessage: network error: ECONNREFUSED",
    );
  });

  it("handles non-JSON response", async () => {
    fetchMock.mockResolvedValue({
      status: 502,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    });
    await expect(callSlackApi("tok", "chat.postMessage")).rejects.toThrow(
      "Slack API chat.postMessage: non-JSON response (HTTP 502)",
    );
  });
});

// --- openSocketModeUrl ---

describe("openSocketModeUrl", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = installFetchMock();
  });

  afterEach(restoreFetch);

  it("returns the WebSocket URL from apps.connections.open", async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: true, url: "wss://slack.example.com/socket" }),
    });
    const url = await openSocketModeUrl("xapp-token");
    expect(url).toBe("wss://slack.example.com/socket");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/apps.connections.open",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer xapp-token" }),
      }),
    );
  });

  it("throws when API returns error", async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: "invalid_app_token" }),
    });
    await expect(openSocketModeUrl("bad-token")).rejects.toThrow("invalid_app_token");
  });
});

// --- SlackTransport ---

describe("SlackTransport", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = installFetchMock({ ok: true });
  });

  afterEach(restoreFetch);

  it("buffers text events", () => {
    const transport = new SlackTransport("tok", "C1");
    transport.emit({ type: "text", content: "Hello " });
    transport.emit({ type: "text", content: "world" });
    expect(transport.getBuffer()).toBe("Hello world");
  });

  it("ignores non-text events", () => {
    const transport = new SlackTransport("tok", "C1");
    transport.emit({ type: "status", message: "thinking" });
    transport.emit({ type: "error", message: "oops" });
    expect(transport.getBuffer()).toBe("");
  });

  it("flush sends buffered text as message", async () => {
    const transport = new SlackTransport("xoxb-tok", "C123");
    transport.emit({ type: "text", content: "Hello!" });
    await transport.flush();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.com/api/chat.postMessage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ channel: "C123", text: "Hello!" }),
      }),
    );
  });

  it("flush does nothing for empty buffer", async () => {
    const transport = new SlackTransport("tok", "C1");
    await transport.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flush does nothing for whitespace-only buffer", async () => {
    const transport = new SlackTransport("tok", "C1");
    transport.emit({ type: "text", content: "   \n  " });
    await transport.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flush clears buffer", async () => {
    const transport = new SlackTransport("tok", "C1");
    transport.emit({ type: "text", content: "Hello" });
    await transport.flush();
    expect(transport.getBuffer()).toBe("");
  });

  it("flush splits long text into multiple messages", async () => {
    const transport = new SlackTransport("tok", "C1");
    const longText = `${"a".repeat(2500)}\n${"b".repeat(2500)}`;
    transport.emit({ type: "text", content: longText });
    await transport.flush();
    // Text exceeds MAX_TEXT_LENGTH (3000), should split into 2 messages
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
