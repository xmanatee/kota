import { afterEach, describe, expect, it, vi } from "vitest";
import { type OutboundHttpTelemetryEvent, OutboundHttpTransport } from "#core/outbound-http/index.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { makeDriveListFiles, makeDriveReadFile } from "./drive.js";

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

function stubFetch(response: { ok?: boolean; status?: number; data?: unknown }) {
  const { ok = true, status = 200, data = {} } = response;
  requestMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

function stubFetchSequence(
  responses: Array<{ ok?: boolean; status?: number; data?: unknown; text?: string }>,
) {
  const queue = [...responses];
  requestMock = vi.fn().mockImplementation(() => {
    const next = queue.shift() ?? { ok: false, status: 500 };
    const ok = next.ok ?? true;
    const status = next.status ?? 200;
    return Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(next.data ?? null),
      text: () => Promise.resolve(next.text ?? JSON.stringify(next.data ?? "")),
    });
  });
}

afterEach(() => {
  requestMock = vi.fn();
  vi.restoreAllMocks();
});

describe("drive_list_files: runner", () => {
  it("returns 'No files found' on empty result", async () => {
    const def = makeDriveListFiles(mockGetToken(), http);
    stubFetch({ data: { files: [] } });

    const result = await def.runner({});
    expect(result.content).toContain("No files found.");
  });

  it("formats file listing with name, type, and size", async () => {
    const def = makeDriveListFiles(mockGetToken(), http);
    stubFetch({
      data: {
        files: [
          {
            id: "f1",
            name: "Budget.xlsx",
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            modifiedTime: "2026-04-10T12:00:00Z",
            size: "51200",
          },
        ],
      },
    });

    const result = await def.runner({});
    expect(result.content).toContain("Budget.xlsx");
    expect(result.content).toContain("50KB");
    expect(result.content).toContain("2026-04-10T12:00:00Z");
  });

  it("caps maxResults at 100", async () => {
    const def = makeDriveListFiles(mockGetToken(), http);
    stubFetch({ data: { files: [] } });

    await def.runner({ maxResults: 500 });
    const url = (requestMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("pageSize=100");
  });

  it("passes query parameter", async () => {
    const def = makeDriveListFiles(mockGetToken(), http);
    stubFetch({ data: { files: [] } });

    await def.runner({ query: "name contains 'report'" });
    const url = (requestMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("q=name");
  });

  it("returns error on API failure", async () => {
    const def = makeDriveListFiles(mockGetToken(), http);
    stubFetch({ ok: false, status: 403, data: { error: { message: "Forbidden" } } });

    const result = await def.runner({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("403");
  });
});

describe("Drive listing completeness", () => {
  it("retains incomplete search evidence across pages and requests completeness fields", async () => {
    stubFetchSequence([
      { data: { incompleteSearch: true, nextPageToken: "a /+" } },
      { data: { files: [{ id: "kept", name: "Budget", mimeType: "text/plain" }], nextPageToken: "b" } },
      { data: { files: [], incompleteSearch: false } },
    ]);
    const result = await makeDriveListFiles(mockGetToken(), http).runner({ query: "name contains 'budget'", maxResults: 2 });
    expect(result.content).toContain("Incomplete results");
    expect(result.content).toContain("incomplete search");
    expect(result.content).toContain("[kept] Budget");
    expect(result.is_error).not.toBe(true);
    const urls = requestMock.mock.calls.map(([url]) => new URL(url));
    expect(urls.map((url) => url.searchParams.get("pageSize"))).toEqual(["2", "2", "1"]);
    expect(urls.map((url) => url.searchParams.get("pageToken"))).toEqual([null, "a /+", "b"]);
    for (const url of urls) {
      expect(url.searchParams.get("q")).toBe("name contains 'budget'");
      expect(url.searchParams.get("orderBy")).toBe("modifiedTime desc");
      expect(url.searchParams.get("fields")).toContain("nextPageToken");
      expect(url.searchParams.get("fields")).toContain("incompleteSearch");
    }
  });

  it("does not claim no files when search is incomplete", async () => {
    stubFetch({ data: { incompleteSearch: true } });
    const result = await makeDriveListFiles(mockGetToken(), http).runner({});
    expect(result.content).toContain("incomplete search");
    expect(result.content).not.toContain("No files found");
  });

  it("accepts empty provider collections with omitted files", async () => {
    stubFetch({ data: { incompleteSearch: false } });
    expect((await makeDriveListFiles(mockGetToken(), http).runner({})).content).toContain("No files found");
  });

  it.each([null, {}, { files: [null] }, { nextPageToken: 2 }, { incompleteSearch: "false" }])(
    "rejects invalid pages: %j", async (data) => {
      stubFetch({ data });
      const result = await makeDriveListFiles(mockGetToken(), http).runner({});
      expect(result.is_error).toBe(true);
      expect(result.content).not.toContain("No files found");
    },
  );
});

describe("drive_read_file: runner", () => {
  it("reads a plain text file directly", async () => {
    const def = makeDriveReadFile(mockGetToken(), http);
    stubFetchSequence([
      { data: { name: "notes.txt", mimeType: "text/plain" } },
      { text: "File content here" },
    ]);

    const result = await def.runner({ id: "f1" });
    expect(result.content).toBe("File: notes.txt\nType: text/plain\n\nFile content here");

    // Second fetch should use alt=media
    const secondUrl = (requestMock as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondUrl).toContain("alt=media");
  });

  it("exports Google Docs as plain text", async () => {
    const def = makeDriveReadFile(mockGetToken(), http);
    stubFetchSequence([
      { data: { name: "My Doc", mimeType: "application/vnd.google-apps.document" } },
      { text: "Exported text content" },
    ]);

    const result = await def.runner({ id: "doc1" });
    expect(result.content).toBe("File: My Doc\nType: application/vnd.google-apps.document\n\nExported text content");

    const secondUrl = (requestMock as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondUrl).toContain("export");
    expect(secondUrl).toContain("mimeType=text/plain");
  });

  it.each([
    { text: "a,b,c\n1,2,3", maxChars: 100, expected: "a,b,c\n1,2,3" },
    { text: "a,b,c\n1,2,3", maxChars: 5, expected: "a,b,c\n... (truncated)" },
    { text: "a,b,c", maxChars: 5, expected: "a,b,c" },
    { text: "", maxChars: 5, expected: "" },
  ])("discloses first-sheet coverage independently of maxChars: %j", async ({ text, maxChars, expected }) => {
    const def = makeDriveReadFile(mockGetToken(), http);
    stubFetchSequence([
      { data: { name: "My Sheet", mimeType: "application/vnd.google-apps.spreadsheet" } },
      { text },
    ]);

    const result = await def.runner({ id: "sheet1", maxChars });
    expect(result.is_error).not.toBe(true);
    expect(result.content).toBe(
      "File: My Sheet\nType: application/vnd.google-apps.spreadsheet\n" +
      "Export: CSV (text/csv), first sheet only. Other sheets, if any, are not read.\n\n" + expected,
    );

    const secondUrl = (requestMock as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondUrl).toContain("export");
    expect(secondUrl).toContain("mimeType=text/csv");
  });

  it("truncates content at maxChars", async () => {
    const def = makeDriveReadFile(mockGetToken(), http);
    const longText = "A".repeat(9000);
    stubFetchSequence([
      { data: { name: "big.txt", mimeType: "text/plain" } },
      { text: longText },
    ]);

    const result = await def.runner({ id: "big1" });
    expect(result.content).toContain("(truncated)");
    expect(result.content.length).toBeLessThan(9000);
  });

  it("returns error when metadata fetch fails", async () => {
    const def = makeDriveReadFile(mockGetToken(), http);
    stubFetch({ ok: false, status: 404, data: { error: { message: "Not Found" } } });

    const result = await def.runner({ id: "missing" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("404");
  });

  it.each(["text/plain", "application/vnd.google-apps.spreadsheet"])("returns an error without claiming a read when content fetch fails: %s", async (mimeType) => {
    const def = makeDriveReadFile(mockGetToken(), http);
    stubFetchSequence([
      { data: { name: "file", mimeType } },
      { ok: false, status: 500, text: "Internal Server Error" },
    ]);

    const result = await def.runner({ id: "f1" });
    expect(result.is_error).toBe(true);
    expect(result.content).toBe("Unavailable: Google Drive content request failed (500). No content read.");
  });
});

// Exercises list -> read through the authenticated adapter and real transport policy.
// Only the Google dispatcher is controlled; no live account is required.
describe("Drive shortcut reads", () => {
  const shortcut = {
    id: "shortcut-1", name: "Old budget title", mimeType: "application/vnd.google-apps.shortcut",
    shortcutDetails: { targetId: "target-1", targetMimeType: "image/png", targetResourceKey: "fixture-key" },
  };
  function provider(responses: Response[]) {
    const requests: Array<{ url: URL; method?: string; headers: Headers }> = [];
    const events: OutboundHttpTelemetryEvent[] = [];
    const transport = new OutboundHttpTransport({
      telemetry: (event) => events.push(event),
      dispatcher: async (url, init) => {
        requests.push({ url, method: init.method, headers: new Headers(init.headers) });
        const response = responses.shift();
        if (!response) throw new Error("Unexpected provider request");
        return response;
      },
    });
    return { requests, events, transport };
  }

  it.each([
    { mimeType: "text/plain", path: "/drive/v3/files/target-1", query: ["alt", "media"] },
    { mimeType: "application/vnd.google-apps.document", path: "/drive/v3/files/target-1/export", query: ["mimeType", "text/plain"] },
    { mimeType: "application/vnd.google-apps.spreadsheet", path: "/drive/v3/files/target-1/export", query: ["mimeType", "text/csv"] },
  ])("reads a listed shortcut using current metadata: $mimeType", async ({ mimeType, path, query }) => {
    const { transport, requests, events } = provider([
      Response.json({ files: [shortcut] }), Response.json(shortcut),
      Response.json({ name: "Current budget title", mimeType }), new Response("a,b,c"),
    ]);
    const getToken = mockGetToken();
    const listing = await makeDriveListFiles(getToken, transport).runner({});
    const listedId = listing.content.match(/\[([^\]]+)\]/)?.[1];
    const result = await makeDriveReadFile(getToken, transport).runner({ id: listedId, maxChars: 3 });
    expect(result.is_error).not.toBe(true);
    expect(result.content).toContain("Shortcut: Old budget title [shortcut-1]\nResolved file ID: target-1");
    expect(result.content).toContain(`File: Current budget title\nType: ${mimeType}`);
    expect(result.content).toContain("a,b\n... (truncated)");
    expect(result.content.includes("first sheet only")).toBe(mimeType.endsWith("spreadsheet"));
    expect(requests).toHaveLength(4);
    expect(requests[3].url.pathname).toBe(path);
    expect(requests[3].url.searchParams.get(query[0])).toBe(query[1]);
    for (const [index, request] of requests.entries()) {
      expect(request.method).toBe("GET");
      expect(request.url.origin).toBe("https://www.googleapis.com");
      expect(request.headers.get("authorization")).toBe("Bearer test-token");
      expect(request.headers.get("x-goog-drive-resource-keys")).toBe(index < 2 ? null : "target-1/fixture-key");
      expect(request.url.toString()).not.toContain("fixture-key");
    }
    expect(JSON.stringify({ listing, result, events })).not.toContain("fixture-key");
  });

  it.each([403, 404])("reports an inaccessible target without exposing provider diagnostics: %s", async (status) => {
    const { transport, requests, events } = provider([
      Response.json(shortcut), Response.json({ error: { message: "fixture-key" } }, { status }),
    ]);
    const result = await makeDriveReadFile(mockGetToken(), transport).runner({ id: shortcut.id });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain(`metadata request failed (${status})`);
    expect(result.content).toContain("Resolved file ID: target-1");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify({ result, events })).not.toContain("fixture-key");
  });

  it("does not expose keys when target content retrieval fails", async () => {
    const { transport } = provider([
      Response.json(shortcut), Response.json({ name: "Target", mimeType: "text/plain" }),
      new Response("fixture-key", { status: 403 }),
    ]);
    const result = await makeDriveReadFile(mockGetToken(), transport).runner({ id: shortcut.id });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("content request failed (403)");
    expect(result.content).not.toContain("fixture-key");
  });

  it.each([
    undefined, {}, { targetId: "" }, { targetId: "../permissions" },
    { targetId: "https://untrusted.example/file" }, { targetId: "t?alt=media" },
    { targetId: "target-1", targetResourceKey: "key,other/injected" },
    { targetId: "target-1", targetResourceKey: "key\r\nInjected: yes" },
  ])("rejects malformed target references before requesting them: %j", async (shortcutDetails) => {
    const { transport, requests } = provider([Response.json({ ...shortcut, shortcutDetails })]);
    const result = await makeDriveReadFile(mockGetToken(), transport).runner({ id: shortcut.id });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("Unavailable:");
    expect(requests).toHaveLength(1);
  });

  it.each([null, {}, { name: "Target" }, { name: "Target", mimeType: 7 }])("rejects malformed target metadata: %j", async (meta) => {
    const { transport, requests } = provider([Response.json(shortcut), Response.json(meta)]);
    const result = await makeDriveReadFile(mockGetToken(), transport).runner({ id: shortcut.id });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("malformed Drive file metadata");
    expect(requests).toHaveLength(2);
  });

  it.each(["application/vnd.google-apps.folder", "application/pdf", "image/png", "application/vnd.google-apps.presentation"])("does not download unsupported targets: %s", async (mimeType) => {
    const { transport, requests } = provider([
      Response.json(shortcut), Response.json({ name: "Target", mimeType }),
    ]);
    const result = await makeDriveReadFile(mockGetToken(), transport).runner({ id: shortcut.id });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain(`Unsupported Drive file: Target (${mimeType})`);
    expect(requests).toHaveLength(2);
  });

  it("does not read trashed targets", async () => {
    const { transport, requests } = provider([
      Response.json(shortcut), Response.json({ name: "Target", mimeType: "text/plain", trashed: true }),
    ]);
    const result = await makeDriveReadFile(mockGetToken(), transport).runner({ id: shortcut.id });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("in the trash");
    expect(requests).toHaveLength(2);
  });

  it.each([true, false])("terminates cyclic references (self: %s)", async (self) => {
    const { transport, requests } = provider(self
      ? [Response.json({ ...shortcut, shortcutDetails: { targetId: shortcut.id } })]
      : [Response.json(shortcut), Response.json({ ...shortcut, shortcutDetails: { targetId: shortcut.id } })]);
    const result = await makeDriveReadFile(mockGetToken(), transport).runner({ id: shortcut.id });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("cyclic Drive shortcut reference");
    expect(requests).toHaveLength(self ? 1 : 2);
  });

  it("bounds non-cyclic shortcut chains", async () => {
    const { transport, requests } = provider(Array.from({ length: 20 }, (_, i) => Response.json({
      ...shortcut, shortcutDetails: { targetId: `chain-${i + 1}` },
    })));
    const result = await makeDriveReadFile(mockGetToken(), transport).runner({ id: "chain-0" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("resolution limit");
    expect(requests.length).toBeLessThan(20);
  });

  it("does not carry a resource key to a different target in a chain", async () => {
    const { transport, requests } = provider([
      Response.json(shortcut), Response.json({ ...shortcut, shortcutDetails: { targetId: "final" } }),
      Response.json({ name: "Final", mimeType: "text/plain" }), new Response("text"),
    ]);
    const result = await makeDriveReadFile(mockGetToken(), transport).runner({ id: shortcut.id });
    expect(result.is_error).not.toBe(true);
    expect(requests[1].headers.get("x-goog-drive-resource-keys")).toBe("target-1/fixture-key");
    expect(requests[2].headers.get("x-goog-drive-resource-keys")).toBeNull();
    expect(requests[3].headers.get("x-goog-drive-resource-keys")).toBeNull();
  });

  it("rejects redirects outside the Google API boundary", async () => {
    const { transport, requests } = provider([
      Response.json(shortcut), new Response(null, { status: 302, headers: { location: "https://untrusted.example/" } }),
    ]);
    const result = await makeDriveReadFile(mockGetToken(), transport).runner({ id: shortcut.id });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("could not be completed");
    expect(requests).toHaveLength(2);
  });
});
