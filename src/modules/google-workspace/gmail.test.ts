import { afterEach, describe, expect, it, vi } from "vitest";
import { makeGmailGetMessage, makeGmailListMessages, makeGmailSend } from "./gmail.js";

const originalFetch = globalThis.fetch;

function mockGetToken(token = "test-token") {
  return vi.fn().mockResolvedValue(token);
}

function stubFetchSequence(responses: Array<{ ok: boolean; status: number; data: unknown }>) {
  const queue = [...responses];
  globalThis.fetch = vi.fn().mockImplementation(() => {
    const next = queue.shift() ?? { ok: false, status: 500, data: null };
    return Promise.resolve({
      ok: next.ok,
      status: next.status,
      json: () => Promise.resolve(next.data),
    });
  });
}

function stubFetch(response: { ok?: boolean; status?: number; data?: unknown }) {
  const { ok = true, status = 200, data = {} } = response;
  stubFetchSequence([{ ok, status, data }]);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("gmail_list_messages: schema", () => {
  const def = makeGmailListMessages(mockGetToken(), "me");

  it("has correct tool name and metadata", () => {
    expect(def.tool.name).toBe("gmail_list_messages");
    expect(def.risk).toBe("safe");
    expect(def.kind).toBe("discovery");
    expect(def.group).toBe("productivity");
  });

  it("has no required fields", () => {
    expect(def.tool.input_schema.required).toEqual([]);
  });
});

describe("gmail_list_messages: runner", () => {
  it("returns 'No messages found' on empty list", async () => {
    const def = makeGmailListMessages(mockGetToken(), "me");
    stubFetch({ data: { messages: [], resultSizeEstimate: 0 } });

    const result = await def.runner({});
    expect(result.content).toBe("No messages found.");
  });

  it("fetches metadata for each message", async () => {
    const def = makeGmailListMessages(mockGetToken(), "me");
    stubFetchSequence([
      { ok: true, status: 200, data: { messages: [{ id: "msg1" }] } },
      {
        ok: true,
        status: 200,
        data: {
          id: "msg1",
          snippet: "Hello there",
          labelIds: ["UNREAD"],
          payload: {
            headers: [
              { name: "Subject", value: "Test Subject" },
              { name: "From", value: "alice@example.com" },
              { name: "Date", value: "2026-04-10" },
            ],
          },
        },
      },
    ]);

    const result = await def.runner({});
    expect(result.content).toContain("Test Subject");
    expect(result.content).toContain("alice@example.com");
    expect(result.content).toContain("[unread]");
    expect(result.content).toContain("Hello there");
  });

  it("returns api error on failed list", async () => {
    const def = makeGmailListMessages(mockGetToken(), "me");
    stubFetch({ ok: false, status: 403, data: { error: { message: "Forbidden" } } });

    const result = await def.runner({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("403");
  });

  it("caps maxResults at 50", async () => {
    const def = makeGmailListMessages(mockGetToken(), "me");
    stubFetch({ data: { messages: [] } });

    await def.runner({ maxResults: 200 });
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("maxResults=50");
  });
});

describe("gmail_get_message: schema", () => {
  const def = makeGmailGetMessage(mockGetToken(), "me");

  it("has correct tool name and metadata", () => {
    expect(def.tool.name).toBe("gmail_get_message");
    expect(def.risk).toBe("safe");
    expect(def.kind).toBe("discovery");
  });

  it("requires id", () => {
    expect(def.tool.input_schema.required).toEqual(["id"]);
  });
});

describe("gmail_get_message: runner", () => {
  it("returns formatted message with decoded body", async () => {
    const def = makeGmailGetMessage(mockGetToken(), "me");
    const encodedBody = Buffer.from("Hello world").toString("base64url");
    stubFetch({
      data: {
        id: "msg1",
        snippet: "Hello world",
        payload: {
          headers: [
            { name: "Subject", value: "Test" },
            { name: "From", value: "bob@test.com" },
            { name: "To", value: "me@test.com" },
            { name: "Date", value: "2026-04-10" },
          ],
          parts: [{ mimeType: "text/plain", body: { data: encodedBody } }],
        },
      },
    });

    const result = await def.runner({ id: "msg1" });
    expect(result.content).toContain("Subject: Test");
    expect(result.content).toContain("From: bob@test.com");
    expect(result.content).toContain("Hello world");
  });

  it("falls back to snippet when no body data", async () => {
    const def = makeGmailGetMessage(mockGetToken(), "me");
    stubFetch({
      data: {
        id: "msg1",
        snippet: "Snippet fallback",
        payload: { headers: [] },
      },
    });

    const result = await def.runner({ id: "msg1" });
    expect(result.content).toContain("Snippet fallback");
  });

  it("returns error on API failure", async () => {
    const def = makeGmailGetMessage(mockGetToken(), "me");
    stubFetch({ ok: false, status: 404, data: { error: { message: "Not Found" } } });

    const result = await def.runner({ id: "missing" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("404");
  });
});

describe("gmail_send: schema", () => {
  const def = makeGmailSend(mockGetToken(), "me");

  it("has correct tool name and is marked dangerous", () => {
    expect(def.tool.name).toBe("gmail_send");
    expect(def.risk).toBe("dangerous");
    expect(def.kind).toBe("action");
  });

  it("requires to, subject, body", () => {
    expect(def.tool.input_schema.required).toEqual(["to", "subject", "body"]);
  });
});

describe("gmail_send: runner", () => {
  it("sends RFC 2822 formatted message", async () => {
    const def = makeGmailSend(mockGetToken(), "me");
    stubFetch({ data: { id: "sent1", threadId: "t1" } });

    const result = await def.runner({
      to: "alice@test.com",
      subject: "Hello",
      body: "World",
    });

    expect(result.content).toContain("sent1");
    expect(result.content).toContain("t1");

    const [, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const sent = JSON.parse(opts.body as string);
    const decoded = Buffer.from(sent.raw, "base64url").toString("utf-8");
    expect(decoded).toContain("To: alice@test.com");
    expect(decoded).toContain("Subject: Hello");
    expect(decoded).toContain("World");
  });

  it("includes Cc header when provided", async () => {
    const def = makeGmailSend(mockGetToken(), "me");
    stubFetch({ data: { id: "s2", threadId: "t2" } });

    await def.runner({
      to: "alice@test.com",
      subject: "Hi",
      body: "Test",
      cc: "bob@test.com",
    });

    const [, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const decoded = Buffer.from(JSON.parse(opts.body as string).raw, "base64url").toString("utf-8");
    expect(decoded).toContain("Cc: bob@test.com");
  });

  it("returns error on API failure", async () => {
    const def = makeGmailSend(mockGetToken(), "me");
    stubFetch({ ok: false, status: 500, data: { error: { message: "Server Error" } } });

    const result = await def.runner({ to: "x", subject: "y", body: "z" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("500");
  });
});
