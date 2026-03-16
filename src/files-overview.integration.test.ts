import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { truncateToolResult } from "./context.js";
import { enableGroup, filterTools, resetGroups } from "./tool-groups.js";
import { FailureTracker } from "./tool-runner.js";
import { getAllTools, executeTool } from "./tools/index.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "fo-int-"));
});

afterEach(async () => {
  resetGroups();
  await rm(testDir, { recursive: true, force: true });
});

describe("files_overview × executeTool (cross-module dispatch)", () => {
  it("dispatches through executeTool and returns structured output", async () => {
    await writeFile(join(testDir, "readme.md"), "# My Project\nHello");
    await writeFile(join(testDir, "data.csv"), "name,age\nAlice,30\nBob,25");
    await writeFile(join(testDir, "config.json"), '{"key": "value"}');

    const result = await executeTool("files_overview", { path: testDir });
    expect(result.is_error).toBeUndefined();
    const text = result.content as string;
    expect(text).toContain("3 files");
    expect(text).toContain("Documents");
    expect(text).toContain("Data");
    // Previews flow through
    expect(text).toContain("My Project");
    expect(text).toContain("2 rows");
  });

  it("returns error for nonexistent path through executeTool", async () => {
    const result = await executeTool("files_overview", {
      path: "/tmp/nonexistent-fo-int-xyz",
    });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("not found");
  });

  it("handles empty directory through executeTool", async () => {
    const result = await executeTool("files_overview", { path: testDir });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("empty");
  });
});

describe("files_overview × FailureTracker (cross-module error flow)", () => {
  it("error results tracked by FailureTracker", async () => {
    const tracker = new FailureTracker();
    // Three identical error results → circuit break
    for (let i = 0; i < 3; i++) {
      const result = await executeTool("files_overview", {
        path: "/tmp/nonexistent-fo-track-xyz",
      });
      const action = tracker.record([
        { tool_use_id: `fo-${i}`, content: result.content, is_error: true },
      ]);
      if (i < 2) expect(action).toBe("continue");
      else expect(action).toBe("circuit_break");
    }
  });
});

describe("files_overview × truncateToolResult (cross-module context)", () => {
  it("large result truncated without corrupting structure", async () => {
    // Create many files to produce a large result
    for (let i = 0; i < 50; i++) {
      await writeFile(join(testDir, `file-${i}.txt`), `Content of file ${i}\n`.repeat(20));
    }
    const result = await executeTool("files_overview", { path: testDir });
    const text = result.content as string;
    expect(text.length).toBeGreaterThan(500);

    // Truncate to a small limit
    const truncated = truncateToolResult(text, 300);
    expect(truncated.length).toBeLessThan(text.length);
    // Should still contain the header line
    expect(truncated).toContain("50 files");
    // Truncation notice present (context.ts uses "chars omitted" format)
    expect(truncated).toContain("chars omitted");
  });
});

describe("files_overview × filterTools (cross-module availability)", () => {
  it("available with no groups enabled (core tools)", () => {
    const names = filterTools(getAllTools()).map((t) => t.name);
    expect(names).toContain("files_overview");
  });

  it("available when 'all' group enabled", () => {
    enableGroup("all");
    const names = filterTools(getAllTools()).map((t) => t.name);
    expect(names).toContain("files_overview");
  });
});

describe("files_overview result contract (cross-module: delegate consumes output)", () => {
  it("result has parseable category sections and summary line", async () => {
    await mkdir(join(testDir, "src"));
    await writeFile(join(testDir, "src", "app.ts"), "export const x = 1;");
    await writeFile(join(testDir, "notes.md"), "# Notes\nSome notes");
    await writeFile(join(testDir, "data.json"), '[1, 2, 3]');

    const result = await executeTool("files_overview", {
      path: testDir,
      max_depth: 1,
    });
    const text = result.content as string;
    const lines = text.split("\n");

    // First line is the summary with file count and size
    expect(lines[0]).toMatch(/Directory:.*\d+ files.*\d+ subdirs/);
    // Category sections exist
    expect(text).toMatch(/Code \(\d+ files?,/);
    expect(text).toMatch(/Documents \(\d+ files?,/);
    expect(text).toMatch(/Data \(\d+ files?,/);
    // Subdirectory listing present
    expect(text).toContain("src");
  });
});
