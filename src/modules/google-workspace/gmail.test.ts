import { afterEach, describe, expect, it, vi } from "vitest";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { makeGmailGetMessage, makeGmailListMessages, makeGmailSend } from "./gmail.js";

let requestMock = vi.fn();
const http = outboundHttpRequestPort((request) =>
  requestMock(String(request.url), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  })
);

function mockGetToken(token = "test-token") {
  return vi.fn().mockResolvedValue(token);
}

function stubFetchSequence(responses: Array<{ ok: boolean; status: number; data: unknown }>) {
  const queue = [...responses];
  requestMock = vi.fn().mockImplementation(() => {
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
  requestMock = vi.fn();
  vi.restoreAllMocks();
});

describe("gmail_list_messages: runner", () => {
  it("returns 'No messages found' on empty list", async () => {
    const def = makeGmailListMessages(mockGetToken(), "me", http);
    stubFetch({ data: { messages: [], resultSizeEstimate: 0 } });

    const result = await def.runner({});
    expect(result.content).toBe("No messages found.");
  });

  it("fetches metadata for each message", async () => {
    const def = makeGmailListMessages(mockGetToken(), "me", http);
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
    const def = makeGmailListMessages(mockGetToken(), "me", http);
    stubFetch({ ok: false, status: 403, data: { error: { message: "Forbidden" } } });

    const result = await def.runner({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("403");
  });

  it("caps maxResults at 50", async () => {
    const def = makeGmailListMessages(mockGetToken(), "me", http);
    stubFetch({ data: { messages: [] } });

    await def.runner({ maxResults: 200 });
    const url = (requestMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("maxResults=50");
  });
});

describe("gmail_get_message: runner", () => {
  it("returns formatted message with decoded body", async () => {
    const def = makeGmailGetMessage(mockGetToken(), "me", http);
    const encodedBody = Buffer.from("Hello world").toString("base64url");
    stubFetch({
      data: {
        id: "msg1",
        snippet: "Hello world",
        payload: {
          mimeType: "multipart/mixed",
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
    const def = makeGmailGetMessage(mockGetToken(), "me", http);
    stubFetch({
      data: {
        id: "msg1",
        snippet: "Snippet fallback",
        payload: { mimeType: "text/plain", headers: [] },
      },
    });

    const result = await def.runner({ id: "msg1" });
    expect(result.content).toContain("Message body unavailable");
    expect(result.content).toContain("Snippet fallback (excerpt only):\nSnippet fallback");
    expect(result.is_error).toBe(true);
  });

  const textPart = (text: string) => ({
    mimeType: "text/plain",
    body: { data: Buffer.from(text).toString("base64url"), size: Buffer.byteLength(text) },
  });
  async function readPayload(payload: unknown) {
    stubFetch({ data: { id: "msg1", snippet: "Old delivery Tuesday", payload } });
    return makeGmailGetMessage(mockGetToken(), "me", http).runner({ id: "msg1" });
  }

  it("reads a direct Unicode body and preserves an explicitly empty body", async () => {
    for (const text of ["Delivery Thursday — café", ""]) {
      const result = await readPayload(textPart(text));
      expect(result.content).toContain(`Message body (plain text):\n${text}`);
      expect(result.content).not.toContain("Snippet fallback");
      expect(result.is_error).toBeUndefined();
    }
  });

  it("reads nested alternatives once and excludes named, explicit and container attachments", async () => {
    const result = await readPayload({
      mimeType: "multipart/mixed",
      parts: [
        { ...textPart("Old delivery Tuesday"), filename: "old.txt" },
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/html", body: { data: Buffer.from("<p>Delivery Thursday</p>").toString("base64url") } },
            { mimeType: "multipart/mixed", parts: [textPart("Delivery Thursday")] },
            textPart("Delivery Thursday"),
          ],
        },
        { ...textPart("Old delivery Tuesday"), headers: [{ name: "CONTENT-DISPOSITION", value: "ATTACHMENT; filename=old.txt" }] },
        { mimeType: "multipart/mixed", filename: "forwarded.mime", parts: [textPart("Old delivery Tuesday")] },
      ],
    });
    expect(result.content.match(/Delivery Thursday/g)).toHaveLength(1);
    expect(result.content).not.toContain("Tuesday");
    expect(result.content).not.toContain("partial");
    expect(result.content).toContain("Attachments excluded from body: 3");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("preserves ordered mixed body segments and labels a missing segment as partial", async () => {
    const result = await readPayload({
      mimeType: "multipart/mixed",
      parts: [textPart("First"), textPart("Second"), { mimeType: "text/plain", body: { attachmentId: "body-id", size: 20 } }],
    });
    expect(result.content).toContain("Message body partial");
    expect(result.content).toContain("First\n\nSecond");
    expect(result.content).toContain("stored separately");
    expect(result.content).not.toContain("Snippet fallback");
    expect(result.content).not.toContain("Attachments excluded");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ mimeType: "text/plain", body: { attachmentId: "body-id", size: 20 } }, "stored separately"],
    [{ mimeType: "text/html", body: { data: "PHA-aGk8L3A-" } }, "Unsupported body content"],
    [{ mimeType: "text/plain", body: { data: "!!!" } }, "Malformed base64url"],
    [{ mimeType: "text/plain", body: { data: "a" } }, "Malformed base64url"],
    [{ mimeType: "text/plain", body: { data: "_w" } }, "Malformed UTF-8"],
    [{ mimeType: "text/plain", body: { data: "aGk", size: 3 } }, "size does not match"],
    [{ mimeType: "text/plain", body: { data: "aGk" }, headers: [{ name: "Content-Type", value: "text/plain; charset=iso-8859-1" }] }, "Unsupported body charset"],
    [{ mimeType: "text/plain", body: { data: 12 } }, "Malformed MIME"],
    [{ mimeType: "multipart/mixed", parts: "bad" }, "Malformed MIME"],
    [{ mimeType: "multipart/mixed", parts: [] }, "Malformed multipart"],
    [null, "Malformed MIME"],
    [{ ...textPart("Tuesday"), filename: "old.txt" }, "No supported message body"],
    [{ ...textPart("Tuesday"), headers: [{ name: "Content-Disposition", value: "inline; filename=old.txt" }] }, "No supported message body"],
  ])("labels unavailable content without presenting the excerpt as a body: %j", async (payload, reason) => {
    const result = await readPayload(payload);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Message body unavailable");
    expect(result.content).toContain(reason);
    expect(result.content).toContain("Snippet fallback (excerpt only):\nOld delivery Tuesday");
  });

  it("rejects malformed responses without throwing", async () => {
    stubFetch({ data: null });
    const result = await makeGmailGetMessage(mockGetToken(), "me", http).runner({ id: "msg1" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("malformed Gmail message response");
  });

  it("does not hide malformed alternatives behind a readable representation", async () => {
    const result = await readPayload({ mimeType: "multipart/alternative", parts: [textPart("Hello"), null] });
    expect(result.content).toContain("Message body partial");
    expect(result.content).toContain("Malformed MIME");
  });

  it("bounds MIME depth and part count and reports omitted content", async () => {
    let deep: unknown = textPart("Hidden body");
    for (let i = 0; i < 30; i++) deep = { mimeType: "multipart/mixed", parts: [deep] };
    const depthResult = await readPayload(deep);
    expect(depthResult.is_error).toBe(true);
    expect(depthResult.content).toContain("traversal limit");
    const wideResult = await readPayload({ mimeType: "multipart/mixed", parts: Array.from({ length: 300 }, () => textPart("segment")) });
    expect(wideResult.content).toContain("Message body partial");
    expect(wideResult.content).toContain("traversal limit");
    expect(wideResult.content.match(/segment/g)?.length).toBeLessThan(300);
  });

  it("labels decoding and rendered output limits", async () => {
    const unavailable = await readPayload(textPart("x".repeat(60_000)));
    expect(unavailable.content).toContain("Body decoding limit exceeded");
    expect(unavailable.is_error).toBe(true);
    const partial = await readPayload(textPart("x".repeat(40_000)));
    expect(partial.content).toContain("Message body partial");
    expect(partial.content).toContain("Body truncated by output limit");
    expect(partial.content.length).toBeLessThan(33_000);
  });

  it("returns error on API failure", async () => {
    const def = makeGmailGetMessage(mockGetToken(), "me", http);
    stubFetch({ ok: false, status: 404, data: { error: { message: "Not Found" } } });

    const result = await def.runner({ id: "missing" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("404");
  });
});

describe("gmail_send: runner", () => {
  it("sends RFC 2822 formatted message", async () => {
    const def = makeGmailSend(mockGetToken(), "me", http);
    stubFetch({ data: { id: "sent1", threadId: "t1" } });

    const result = await def.runner({
      to: "alice@test.com",
      subject: "Hello",
      body: "World",
    });

    expect(result.content).toContain("sent1");
    expect(result.content).toContain("t1");

    const [, opts] = (requestMock as ReturnType<typeof vi.fn>).mock.calls[0];
    const sent = JSON.parse(opts.body as string);
    const decoded = Buffer.from(sent.raw, "base64url").toString("utf-8");
    expect(decoded).toContain("To: alice@test.com");
    expect(decoded).toContain("Subject: Hello");
    expect(decoded).toContain("World");
  });

  it("includes Cc header when provided", async () => {
    const def = makeGmailSend(mockGetToken(), "me", http);
    stubFetch({ data: { id: "s2", threadId: "t2" } });

    await def.runner({
      to: "alice@test.com",
      subject: "Hi",
      body: "Test",
      cc: "bob@test.com",
    });

    const [, opts] = (requestMock as ReturnType<typeof vi.fn>).mock.calls[0];
    const decoded = Buffer.from(JSON.parse(opts.body as string).raw, "base64url").toString("utf-8");
    expect(decoded).toContain("Cc: bob@test.com");
  });

  it("returns error on API failure", async () => {
    const def = makeGmailSend(mockGetToken(), "me", http);
    stubFetch({ ok: false, status: 500, data: { error: { message: "Server Error" } } });

    const result = await def.runner({ to: "x", subject: "y", body: "z" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("500");
  });
});
