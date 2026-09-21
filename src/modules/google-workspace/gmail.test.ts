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
    expect(result.content).toContain("No messages found.");
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

describe("Gmail listing completeness", () => {
  it("follows pages with the selected account and query and retains failed detail IDs", async () => {
    const token = mockGetToken();
    requestMock.mockImplementation(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      if (url.searchParams.has("format")) {
        if (url.pathname.endsWith("/missing")) return Response.json({}, { status: 404 });
        return Response.json({ id: "kept", snippet: "Readable excerpt", payload: { headers: [{ name: "subject", value: "Planning" }] } });
      }
      if (!url.searchParams.has("pageToken")) return Response.json({ nextPageToken: "a /+" });
      if (url.searchParams.get("pageToken") === "a /+") return Response.json({ messages: [{ id: "kept" }], nextPageToken: "b" });
      return Response.json({ messages: [{ id: "missing" }] });
    });
    const result = await makeGmailListMessages(token, "selected@example.test", http).runner({ query: "is:unread", maxResults: 2 });
    expect(result.content).toContain("Complete message list");
    expect(result.content).toContain("Message details incomplete: 1 of 2 unavailable");
    expect(result.content).toContain("[kept] Planning");
    expect(result.content).toContain("[missing] Details unavailable: Google API error (404)");
    expect(result.is_error).toBe(true);
    expect(token).toHaveBeenCalledTimes(1);
    const urls = requestMock.mock.calls.map(([url]) => new URL(url));
    expect(urls.every((url) => decodeURIComponent(url.pathname).startsWith("/gmail/v1/users/selected@example.test/messages"))).toBe(true);
    const listUrls = urls.filter((url) => !url.searchParams.has("format"));
    expect(listUrls.map((url) => url.searchParams.get("maxResults"))).toEqual(["2", "2", "1"]);
    expect(listUrls.every((url) => url.searchParams.get("q") === "is:unread")).toBe(true);
  });

  it.each([
    () => { throw new Error("secret failure"); },
    () => new Response("invalid json"),
    () => Response.json({ id: "other-message" }),
    () => Response.json({ id: "missing", payload: { headers: [null] } }),
  ])("keeps successful details when another detail is unavailable", async (failure) => {
    requestMock.mockResolvedValueOnce(Response.json({ messages: [{ id: "kept" }, { id: "missing" }] }))
      .mockResolvedValueOnce(Response.json({ id: "kept", snippet: "Readable" }))
      .mockImplementationOnce(failure);
    const result = await makeGmailListMessages(mockGetToken(), "me", http).runner({});
    expect(result.content).toContain("Readable");
    expect(result.content).toContain("[missing] Details unavailable");
    expect(result.content).toContain("2 message(s) listed; 1 details retrieved");
    expect(result.content).not.toContain("secret failure");
    expect(result.is_error).toBe(true);
  });

  it("reports all detail failures without claiming an empty list", async () => {
    stubFetchSequence([
      { ok: true, status: 200, data: { messages: [{ id: "missing" }] } },
      { ok: false, status: 500, data: {} },
    ]);
    const result = await makeGmailListMessages(mockGetToken(), "me", http).runner({});
    expect(result.content).toContain("1 message(s) listed; 0 details retrieved");
    expect(result.content).toContain("1 of 1 unavailable");
    expect(result.content).not.toContain("No messages found");
  });

  it("accepts the provider's empty list with omitted messages", async () => {
    stubFetch({ data: { resultSizeEstimate: 0 } });
    expect((await makeGmailListMessages(mockGetToken(), "me", http).runner({})).content).toContain("No messages found");
  });

  it.each([null, {}, { messages: [null] }, { nextPageToken: "" }, { resultSizeEstimate: "0" }])(
    "rejects invalid pages: %j", async (data) => {
      stubFetch({ data });
      const result = await makeGmailListMessages(mockGetToken(), "me", http).runner({});
      expect(result.is_error).toBe(true);
      expect(result.content).not.toContain("No messages found");
    },
  );
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

  it("rejects malformed responses without throwing", async () => {
    stubFetch({ data: null });
    const result = await makeGmailGetMessage(mockGetToken(), "me", http).runner({ id: "msg1" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("malformed Gmail message response");
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

const reply = { to: "chosen@example.test", subject: "Planning", body: "Confirmed", replyToMessageId: "parent", replyThreadId: "conversation" };
function parentMessage(id = "parent", threadId = "conversation") {
  return { id, threadId, payload: { headers: [
    { name: "Subject", value: "Planning" },
    { name: "Message-ID", value: `<${id}@example.test>` },
    { name: "References", value: "<ancestor@example.test>\r\n <previous@example.test>" },
    { name: "To", value: "unapproved@example.test" },
    { name: "Cc", value: "also-unapproved@example.test" },
  ] } };
}

describe("Gmail reply provider boundary", () => {
  it.each(["parent", "unrelated"])("binds %s by retrieved identity even with identical subjects", async (id) => {
    const threadId = `thread-${id}`;
    stubFetchSequence([
      { ok: true, status: 200, data: parentMessage(id, threadId) },
      { ok: true, status: 200, data: { id: "sent", threadId } },
    ]);
    const result = await makeGmailSend(mockGetToken(), "selected@example.test", http).runner({ ...reply, replyToMessageId: id, replyThreadId: threadId });
    expect(result.is_error).not.toBe(true);
    expect(result.content).toContain(`reply to message ${id} in thread ${threadId}`);
    const [url, opts] = requestMock.mock.calls[1];
    expect(url).toContain("users/selected%40example.test/messages/send");
    const request = JSON.parse(opts.body);
    expect(request.threadId).toBe(threadId);
    const raw = Buffer.from(request.raw, "base64url").toString();
    expect(raw).toContain(`In-Reply-To: <${id}@example.test>`);
    expect(raw.replace(/\r\n\s+/g, " ")).toContain(`References: <ancestor@example.test> <previous@example.test> <${id}@example.test>`);
    expect(raw).toContain("To: chosen@example.test");
    expect(raw).toContain("Subject: Planning");
    expect(raw).not.toContain("unapproved");
    expect(raw).not.toContain("Cc:");
  });

  it.each([
    null,
    parentMessage("other"),
    parentMessage("parent", "other-thread"),
    { ...parentMessage(), threadId: undefined },
    { ...parentMessage(), payload: { headers: [] } },
    ...["Subject", "Message-ID", "References"].flatMap((name) => [
      { ...parentMessage(), payload: { headers: parentMessage().payload.headers.filter((h) => h.name !== name).concat({ name, value: "bad\r\nBcc: injected@example.test" }) } },
      { ...parentMessage(), payload: { headers: [...parentMessage().payload.headers, { name, value: "duplicate" }] } },
    ]),
    { ...parentMessage(), payload: { headers: parentMessage().payload.headers.map((h) => h.name === "Message-ID" ? { ...h, value: "not-an-rfc-id" } : h) } },
  ])("does not POST with unavailable, changed or unsafe metadata: %j", async (data) => {
    stubFetch({ data });
    const result = await makeGmailSend(mockGetToken(), "me", http).runner(reply);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Reply not sent");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("uses the parent's In-Reply-To when References is absent", async () => {
    const parent = parentMessage();
    parent.payload.headers = parent.payload.headers.filter((h) => h.name !== "References");
    parent.payload.headers.push({ name: "In-Reply-To", value: "<previous@example.test>" });
    stubFetchSequence([{ ok: true, status: 200, data: parent }, { ok: true, status: 200, data: { id: "sent", threadId: "conversation" } }]);
    await makeGmailSend(mockGetToken(), "me", http).runner(reply);
    expect(Buffer.from(JSON.parse(requestMock.mock.calls[1][1].body).raw, "base64url").toString()).toContain("References: <previous@example.test> <parent@example.test>");
  });

  it.each([
    { ...reply, replyThreadId: undefined },
    { ...reply, replyToMessageId: undefined },
    { ...reply, subject: "Planning\nBcc: hidden@example.test" },
    { ...reply, to: "chosen@example.test\r\nBcc: hidden@example.test" },
    { ...reply, cc: "x\u0000y" },
    { ...reply, replyToMessageId: "../other?format=raw" },
  ])("rejects unsafe or incomplete input before any request: %j", async (input) => {
    const result = await makeGmailSend(mockGetToken(), "me", http).runner(input);
    expect(result.is_error).toBe(true);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("fails closed on an unreadable parent and subject mismatch", async () => {
    for (const response of [{ ok: false, status: 404, data: {} }, { ok: true, status: 200, data: parentMessage() }]) {
      stubFetch(response);
      const result = await makeGmailSend(mockGetToken(), "me", http).runner({ ...reply, subject: "Changed subject" });
      expect(result.is_error).toBe(true);
      expect(requestMock).toHaveBeenCalledTimes(1);
    }
  });

  it.each([null, {}, { id: "sent", threadId: "other" }, { id: "parent", threadId: "conversation" }])("does not confirm inconsistent send response: %j", async (data) => {
    stubFetchSequence([{ ok: true, status: 200, data: parentMessage() }, { ok: true, status: 200, data }]);
    const result = await makeGmailSend(mockGetToken(), "me", http).runner(reply);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("outcome uncertain");
  });

  it("does not leak a transport failure or encourage blind resend", async () => {
    requestMock.mockResolvedValueOnce(Response.json(parentMessage())).mockRejectedValueOnce(new Error("secret-token"));
    const result = await makeGmailSend(mockGetToken(), "me", http).runner(reply);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("check Gmail before retrying");
    expect(result.content).not.toContain("secret-token");
  });
});
