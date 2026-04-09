/**
 * Cross-module integration tests: file-read × json-preview × csv-preview
 * Verifies that runFileRead correctly invokes preview formatters and
 * produces coherent output for JSON, JSONL, CSV, and TSV files.
 */

import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFileRead } from "./modules/filesystem/file-read.js";

function tmpFile(name: string, content: string): string {
  const p = join(tmpdir(), `kota-test-${Date.now()}-${name}`);
  writeFileSync(p, content, "utf-8");
  return p;
}

const cleanup: string[] = [];
afterEach(() => {
  for (const f of cleanup) {
    if (existsSync(f)) unlinkSync(f);
  }
  cleanup.length = 0;
});

describe("file-read × json-preview integration", () => {
  it("prepends structural preview for a JSON object file", async () => {
    const data = JSON.stringify({ name: "Alice", age: 30, active: true });
    const p = tmpFile("obj.json", data);
    cleanup.push(p);

    const result = await runFileRead({ path: p });
    expect(result.is_error).toBeFalsy();
    // Should have JSON preview header
    expect(result.content).toMatch(/^\[JSON: Object with 3 keys/);
    // Should still contain the raw numbered content
    expect(result.content).toContain('"Alice"');
  });

  it("prepends array summary for a JSON array file", async () => {
    const data = JSON.stringify([
      { id: 1, user: "bob" },
      { id: 2, user: "carol" },
      { id: 3, user: "dave" },
    ]);
    const p = tmpFile("arr.json", data);
    cleanup.push(p);

    const result = await runFileRead({ path: p });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toMatch(/\[JSON: Array with 3 elements/);
    expect(result.content).toContain("Element schema");
    expect(result.content).toContain("id: number");
  });

  it("falls through to plain text for malformed JSON", async () => {
    const p = tmpFile("bad.json", '{ "broken": true, }');
    cleanup.push(p);

    const result = await runFileRead({ path: p });
    expect(result.is_error).toBeFalsy();
    // No JSON preview header (formatJsonPreview returns "")
    expect(result.content).not.toMatch(/^\[JSON:/);
    // Still shows raw content as numbered lines
    expect(result.content).toContain('"broken"');
  });

  it("handles JSONL files with structural preview", async () => {
    const lines = [
      JSON.stringify({ ts: "2024-01-01", level: "info", msg: "started" }),
      JSON.stringify({ ts: "2024-01-01", level: "error", msg: "failed" }),
      JSON.stringify({ ts: "2024-01-02", level: "info", msg: "recovered" }),
    ].join("\n");
    const p = tmpFile("log.jsonl", lines);
    cleanup.push(p);

    const result = await runFileRead({ path: p });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toMatch(/\[JSONL: 3 lines/);
    expect(result.content).toContain("ts: string");
  });
});

describe("file-read × csv-preview integration", () => {
  it("prepends CSV metadata with column types and ranges", async () => {
    const csv = [
      "name,age,score",
      "Alice,30,95.5",
      "Bob,25,88.0",
      "Carol,35,92.3",
    ].join("\n");
    const p = tmpFile("data.csv", csv);
    cleanup.push(p);

    const result = await runFileRead({ path: p });
    expect(result.is_error).toBeFalsy();
    // CSV metadata header
    expect(result.content).toMatch(/\[CSV: 3 rows × 3 cols/);
    expect(result.content).toContain("age:numeric");
    expect(result.content).toContain("score:numeric");
    // Numeric ranges
    expect(result.content).toMatch(/\[Ranges:/);
    // Raw content still present
    expect(result.content).toContain("Alice");
  });

  it("prepends TSV metadata for .tsv files", async () => {
    const tsv = ["host\tstatus\tlatency", "a.com\t200\t45", "b.com\t500\t120"].join("\n");
    const p = tmpFile("servers.tsv", tsv);
    cleanup.push(p);

    const result = await runFileRead({ path: p });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toMatch(/\[CSV: 2 rows × 3 cols/);
    expect(result.content).toContain("status:numeric");
    expect(result.content).toContain("latency:numeric");
  });
});

describe("file-read preview edge cases", () => {
  it("handles empty JSON file gracefully", async () => {
    const p = tmpFile("empty.json", "");
    cleanup.push(p);

    const result = await runFileRead({ path: p });
    expect(result.is_error).toBeFalsy();
    // Empty content — formatJsonPreview("", ...) returns "" (parse failure)
    // Should not crash, should return empty-ish content
    expect(result.content).toBeDefined();
    expect(result.content).not.toMatch(/^\[JSON:/);
  });

  it("scalar JSON values get scalar preview", async () => {
    const p = tmpFile("scalar.json", '"just a string"');
    cleanup.push(p);

    const result = await runFileRead({ path: p });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toMatch(/\[JSON: scalar "just a string"\]/);
  });
});
