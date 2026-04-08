import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHttpRequest } from "./extensions/web-access/http-request.js";
import { clearCustomGroups, detectToolGroups, enableGroup, getActiveToolNames, registerCustomGroup, resetGroups } from "./tool-groups.js";

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

  beforeEach(() => {
    registerCustomGroup("web", ["web_search", "web_fetch", "http_request"]);
    registerCustomGroup("code", ["code_exec", "notebook", "sqlite"]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    clearCustomGroups();
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

  // --- Cross-module: table formatting + truncation interaction ---

  it("large tabular JSON is table-formatted then truncated cleanly", async () => {
    // 60 rows × 5 cols → table formatted (>50 rows truncated by table), then
    // if the table text exceeds max_response_length, truncation adds save_to hint
    const rows = Array.from({ length: 60 }, (_, i) => ({
      id: i, name: `product-${i}`, price: (i * 10.5).toFixed(2),
      category: "electronics", updated: "2024-06-01",
    }));
    mockFetch({ body: JSON.stringify(rows), contentType: "application/json" });

    const result = await runHttpRequest({
      url: "https://api.example.com/products",
      max_response_length: 500, // force truncation of the table
    });

    // Should have table formatting indicators
    expect(result.content).toContain("|");
    // Should have truncation with save_to hint
    expect(result.content).toContain("[Truncated");
    expect(result.content).toContain("save_to");
  });

  it("save_to preserves raw JSON while inline shows table", async () => {
    // Same data should produce different representations:
    // inline → markdown table; save_to → raw JSON for code_exec
    const data = [
      { repo: "alpha", stars: 120, stale: false },
      { repo: "beta", stars: 45, stale: true },
    ];
    const jsonStr = JSON.stringify(data);
    mockFetch({ body: jsonStr, contentType: "application/json" });

    // First: inline display (table formatted)
    const inlineResult = await runHttpRequest({ url: "https://api.example.com/repos" });
    expect(inlineResult.content).toContain("| repo");
    expect(inlineResult.content).toContain("| alpha");

    // Second: save_to (raw JSON preserved for code_exec to parse)
    mockFetch({ body: jsonStr, contentType: "application/json" });
    const savePath = tempPath("repos.json");
    const savedResult = await runHttpRequest({
      url: "https://api.example.com/repos",
      save_to: savePath,
    });
    expect(savedResult.content).toContain("Saved to");
    const raw = readFileSync(savePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].repo).toBe("alpha");
    expect(parsed[1].stale).toBe(true);
  });

  it("tabular data with pipe chars in values renders valid table via inline", async () => {
    // Real-world: GitHub API repos with topics like "ci|cd"
    const data = [
      { name: "my-repo", topics: "ci|cd", url: "https://github.com/org/my-repo" },
      { name: "other", topics: "web|api|rest", url: "https://github.com/org/other" },
    ];
    mockFetch({ body: JSON.stringify(data), contentType: "application/json" });
    const result = await runHttpRequest({ url: "https://api.github.com/repos" });

    // Pipes in values should be escaped, table structure intact
    expect(result.content).toContain("\\|");
    // Table still has proper column separators
    const lines = result.content.split("\n");
    const dataLines = lines.filter(l => l.includes("my-repo"));
    expect(dataLines.length).toBe(1);
  });
});
