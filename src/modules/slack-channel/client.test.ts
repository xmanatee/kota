import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import {
  callSlackApi,
  MAX_TEXT_LENGTH,
  openSocketModeUrl,
  SlackTransport,
} from "./client.js";

// --- Shared fetch mock helper ---

let activeFetch = vi.fn();
const http = outboundHttpRequestPort((request) =>
  activeFetch(String(request.url), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  })
);

function installFetchMock(defaultResponse?: unknown) {
  const mock = vi.fn();
  if (defaultResponse !== undefined) {
    mock.mockResolvedValue({ json: () => Promise.resolve(defaultResponse) });
  }
  activeFetch = mock;
  return mock;
}

function restoreFetch() {}

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
      http,
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
    await callSlackApi("tok", "chat.postMessage", { channel: "C1", text: "hi" }, http);
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
    await callSlackApi("tok", "auth.test", undefined, http);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: undefined }),
    );
  });

  it("throws on API error response", async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: "invalid_auth" }),
    });
    await expect(callSlackApi("bad", "auth.test", undefined, http)).rejects.toThrow(
      "Slack API auth.test: invalid_auth",
    );
  });

  it("wraps network errors with method context", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(callSlackApi("tok", "chat.postMessage", undefined, http)).rejects.toThrow(
      "Slack API chat.postMessage: network error: ECONNREFUSED",
    );
  });

  it("handles non-JSON response", async () => {
    fetchMock.mockResolvedValue({
      status: 502,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    });
    await expect(callSlackApi("tok", "chat.postMessage", undefined, http)).rejects.toThrow(
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
    const url = await openSocketModeUrl("xapp-token", http);
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
    await expect(openSocketModeUrl("bad-token", http)).rejects.toThrow("invalid_app_token");
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
    const transport = new SlackTransport("tok", "C1", http);
    transport.emit({ type: "text", content: "Hello " });
    transport.emit({ type: "text", content: "world" });
    expect(transport.getBuffer()).toBe("Hello world");
  });

  it("ignores non-text events", () => {
    const transport = new SlackTransport("tok", "C1", http);
    transport.emit({ type: "status", message: "thinking" });
    transport.emit({ type: "error", message: "oops" });
    expect(transport.getBuffer()).toBe("");
  });

  it("flush sends buffered text as message", async () => {
    const transport = new SlackTransport("xoxb-tok", "C123", http);
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
    const transport = new SlackTransport("tok", "C1", http);
    await transport.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flush does nothing for whitespace-only buffer", async () => {
    const transport = new SlackTransport("tok", "C1", http);
    transport.emit({ type: "text", content: "   \n  " });
    await transport.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flush clears buffer", async () => {
    const transport = new SlackTransport("tok", "C1", http);
    transport.emit({ type: "text", content: "Hello" });
    await transport.flush();
    expect(transport.getBuffer()).toBe("");
  });

  it.each([MAX_TEXT_LENGTH - 2, MAX_TEXT_LENGTH - 1])("flush preserves emoji at boundary %i", async (prefixLength) => {
    const transport = new SlackTransport("tok", "C1", http);
    const text = `${"a".repeat(prefixLength)}😀`;
    transport.emit({ type: "text", content: text });
    await transport.flush();
    const bodies = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(bodies).toEqual(prefixLength === MAX_TEXT_LENGTH - 2
      ? [{ channel: "C1", text }]
      : [{ channel: "C1", text: "a".repeat(prefixLength) }, { channel: "C1", text: "😀" }]);
  });

  it("flush fails fast and clears the buffer when delivery fails", async () => {
    const transport = new SlackTransport("tok", "C1", http);
    transport.emit({ type: "text", content: "a".repeat(MAX_TEXT_LENGTH * 3) });
    fetchMock.mockRejectedValueOnce(new Error("disconnected"));
    await expect(transport.flush()).rejects.toThrow("disconnected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await transport.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("flush splits long text into multiple messages", async () => {
    const transport = new SlackTransport("tok", "C1", http);
    const longText = `${"a".repeat(2500)}\n${"b".repeat(2500)}`;
    transport.emit({ type: "text", content: longText });
    await transport.flush();
    // Text exceeds MAX_TEXT_LENGTH (3000), should split into 2 messages
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
