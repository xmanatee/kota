import { describe, it, expect, vi, afterEach } from "vitest";
import { runHttpRequest } from "./tools/http-request.js";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectToolGroups, enableGroup, resetGroups, getActiveToolNames } from "./tool-groups.js";

/**
 * Cross-module integration tests for the http_request → code_exec data pipeline.
 * Verifies that http_request save_to produces files that code_exec can consume.
 *
 * Tests the handoff contract: http_request writes valid files at expected paths,
 * with correct content and encoding, matching what code_exec (Python/Node) would read.
 */

function mockFetch(opts: {
  status?: number;
  statusText?: string;
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
  arrayBuffer?: ArrayBuffer;
}) {
  const { status = 200, statusText = "OK", body = "", contentType = "text/plain", headers = {} } = opts;
  const responseHeaders = new Map<string, string>([
    ["content-type", contentType],
    ...Object.entries(headers),
  ]);
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 400,
    status,
    statusText,
    headers: {
      get: (name: string) => responseHeaders.get(name.toLowerCase()) ?? null,
    },
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(opts.arrayBuffer ?? new TextEncoder().encode(body).buffer),
  });
}

describe("http_request → code_exec data pipeline", () => {
  const originalFetch = globalThis.fetch;
  const tempFiles: string[] = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    resetGroups();
    for (const f of tempFiles) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
    tempFiles.length = 0;
  });

  function tempPath(name: string): string {
    const p = join(tmpdir(), `kota-test-${Date.now()}-${name}`);
    tempFiles.push(p);
    return p;
  }

  it("saves CSV data that Python could parse with pandas", async () => {
    const csvData = "date,magnitude,latitude,longitude\n2024-01-15,4.2,34.05,-118.25\n2024-01-15,3.1,36.77,-119.42\n2024-01-15,5.8,37.77,-122.42\n";
    mockFetch({ body: csvData, contentType: "text/csv" });

    const savePath = tempPath("earthquakes.csv");
    const result = await runHttpRequest({
      url: "https://earthquake.usgs.gov/data.csv",
      save_to: savePath,
    });

    // Verify http_request reports success
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("200 OK");
    expect(result.content).toContain(`Saved to ${savePath}`);

    // Verify file exists and content matches exactly what Python would read
    expect(existsSync(savePath)).toBe(true);
    const written = readFileSync(savePath, "utf-8");
    expect(written).toBe(csvData);

    // Verify the CSV structure is valid (header + data rows)
    const lines = written.trim().split("\n");
    expect(lines.length).toBe(4); // header + 3 data rows
    expect(lines[0]).toBe("date,magnitude,latitude,longitude");
  });

  it("saves JSON API response preserving structure for code_exec", async () => {
    const jsonData = JSON.stringify({
      results: [
        { id: 1, value: 42.5, label: "alpha" },
        { id: 2, value: 17.3, label: "beta" },
      ],
      total: 2,
    });
    mockFetch({ body: jsonData, contentType: "application/json" });

    const savePath = tempPath("api-data.json");
    const result = await runHttpRequest({
      url: "https://api.example.com/export",
      save_to: savePath,
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Saved to");

    // Verify JSON round-trips correctly (code_exec would JSON.parse or pd.read_json)
    const written = readFileSync(savePath, "utf-8");
    const parsed = JSON.parse(written);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].value).toBe(42.5);
    expect(parsed.total).toBe(2);
  });

  it("saves UTF-8 content with special characters intact", async () => {
    const csvWithUnicode = "name,city,notes\nJosé,São Paulo,café résumé\n田中,東京,テストデータ\n";
    mockFetch({ body: csvWithUnicode, contentType: "text/csv; charset=utf-8" });

    const savePath = tempPath("unicode-data.csv");
    const result = await runHttpRequest({
      url: "https://api.example.com/data",
      save_to: savePath,
    });

    expect(result.is_error).toBeUndefined();
    const written = readFileSync(savePath, "utf-8");
    expect(written).toBe(csvWithUnicode);
    // Verify specific Unicode characters survive the pipeline
    expect(written).toContain("São Paulo");
    expect(written).toContain("東京");
  });

  it("pipeline prompt enables both http and code tool groups", () => {
    // A data pipeline prompt should activate both http_request and code_exec
    const prompt = "Fetch the dataset from the API and analyze it with Python";
    const groups = detectToolGroups(prompt);
    for (const g of groups) enableGroup(g);
    const active = getActiveToolNames();
    expect(active.has("http_request")).toBe(true);
    expect(active.has("code_exec")).toBe(true);
  });

  it("handles 4xx save — error status preserved for code_exec error handling", async () => {
    mockFetch({
      status: 404,
      statusText: "Not Found",
      body: '{"error": "Dataset not found"}',
      contentType: "application/json",
    });

    const savePath = tempPath("missing.json");
    const result = await runHttpRequest({
      url: "https://api.example.com/missing",
      save_to: savePath,
    });

    // File is saved even on 4xx (agent can inspect the error response)
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("404");
    expect(existsSync(savePath)).toBe(true);
    const written = readFileSync(savePath, "utf-8");
    expect(JSON.parse(written).error).toBe("Dataset not found");
  });
});
