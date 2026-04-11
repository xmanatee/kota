import { afterEach, describe, expect, it, vi } from "vitest";
import { makeDriveListFiles, makeDriveReadFile } from "./drive.js";

const originalFetch = globalThis.fetch;

function mockGetToken(token = "test-token") {
  return vi.fn().mockResolvedValue(token);
}

function stubFetch(response: { ok?: boolean; status?: number; data?: unknown }) {
  const { ok = true, status = 200, data = {} } = response;
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

function stubFetchSequence(
  responses: Array<{ ok?: boolean; status?: number; data?: unknown; text?: string }>,
) {
  const queue = [...responses];
  globalThis.fetch = vi.fn().mockImplementation(() => {
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
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("drive_list_files: schema", () => {
  const def = makeDriveListFiles(mockGetToken());

  it("has correct tool name and metadata", () => {
    expect(def.tool.name).toBe("drive_list_files");
    expect(def.risk).toBe("safe");
    expect(def.kind).toBe("discovery");
    expect(def.group).toBe("productivity");
  });

  it("has no required fields", () => {
    expect(def.tool.input_schema.required).toEqual([]);
  });
});

describe("drive_list_files: runner", () => {
  it("returns 'No files found' on empty result", async () => {
    const def = makeDriveListFiles(mockGetToken());
    stubFetch({ data: { files: [] } });

    const result = await def.runner({});
    expect(result.content).toBe("No files found.");
  });

  it("formats file listing with name, type, and size", async () => {
    const def = makeDriveListFiles(mockGetToken());
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
    const def = makeDriveListFiles(mockGetToken());
    stubFetch({ data: { files: [] } });

    await def.runner({ maxResults: 500 });
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("pageSize=100");
  });

  it("passes query parameter", async () => {
    const def = makeDriveListFiles(mockGetToken());
    stubFetch({ data: { files: [] } });

    await def.runner({ query: "name contains 'report'" });
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("q=name");
  });

  it("returns error on API failure", async () => {
    const def = makeDriveListFiles(mockGetToken());
    stubFetch({ ok: false, status: 403, data: { error: { message: "Forbidden" } } });

    const result = await def.runner({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("403");
  });
});

describe("drive_read_file: schema", () => {
  const def = makeDriveReadFile(mockGetToken());

  it("has correct tool name and metadata", () => {
    expect(def.tool.name).toBe("drive_read_file");
    expect(def.risk).toBe("safe");
    expect(def.kind).toBe("discovery");
  });

  it("requires id", () => {
    expect(def.tool.input_schema.required).toEqual(["id"]);
  });
});

describe("drive_read_file: runner", () => {
  it("reads a plain text file directly", async () => {
    const def = makeDriveReadFile(mockGetToken());
    stubFetchSequence([
      { data: { name: "notes.txt", mimeType: "text/plain" } },
      { text: "File content here" },
    ]);

    const result = await def.runner({ id: "f1" });
    expect(result.content).toContain("notes.txt");
    expect(result.content).toContain("File content here");

    // Second fetch should use alt=media
    const secondUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondUrl).toContain("alt=media");
  });

  it("exports Google Docs as plain text", async () => {
    const def = makeDriveReadFile(mockGetToken());
    stubFetchSequence([
      { data: { name: "My Doc", mimeType: "application/vnd.google-apps.document" } },
      { text: "Exported text content" },
    ]);

    const result = await def.runner({ id: "doc1" });
    expect(result.content).toContain("Exported text content");

    const secondUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondUrl).toContain("export");
    expect(secondUrl).toContain("mimeType=text/plain");
  });

  it("exports Google Sheets as CSV", async () => {
    const def = makeDriveReadFile(mockGetToken());
    stubFetchSequence([
      { data: { name: "My Sheet", mimeType: "application/vnd.google-apps.spreadsheet" } },
      { text: "a,b,c\n1,2,3" },
    ]);

    const result = await def.runner({ id: "sheet1" });
    expect(result.content).toContain("a,b,c");

    const secondUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondUrl).toContain("export");
    expect(secondUrl).toContain("mimeType=text/csv");
  });

  it("truncates content at maxChars", async () => {
    const def = makeDriveReadFile(mockGetToken());
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
    const def = makeDriveReadFile(mockGetToken());
    stubFetch({ ok: false, status: 404, data: { error: { message: "Not Found" } } });

    const result = await def.runner({ id: "missing" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("404");
  });

  it("returns error when content fetch fails", async () => {
    const def = makeDriveReadFile(mockGetToken());
    stubFetchSequence([
      { data: { name: "file.txt", mimeType: "text/plain" } },
      { ok: false, status: 500, text: "Internal Server Error" },
    ]);

    const result = await def.runner({ id: "f1" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("500");
  });
});
