import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ModuleLoader } from "./core/modules/module-loader.js";
import filesystemModule from "./modules/filesystem/index.js";
import { executeToolCalls } from "./core/tools/tool-runner.js";
import { clearCustomTools } from "./core/tools/index.js";

/**
 * Cross-module integration: grep output modes × tool-runner × truncateToolResult.
 * Verifies that grep results in files_only and count_only modes survive the
 * tool-runner pipeline (execution → retry check → truncation) correctly.
 */

const TEST_DIR = join(process.cwd(), ".test-grep-pipeline");

beforeAll(async () => {
  const loader = new ModuleLoader({});
  await loader.loadAll([filesystemModule]);
  mkdirSync(TEST_DIR, { recursive: true });
  // Create enough files to produce a multi-line result
  for (let i = 0; i < 15; i++) {
    writeFileSync(
      join(TEST_DIR, `module_${i}.ts`),
      `import pandas from "pandas";\nconst val_${i} = ${i};\nexport default val_${i};`,
    );
  }
  writeFileSync(join(TEST_DIR, "readme.md"), "# Docs\nNo matching content here.");
});

afterAll(() => {
  clearCustomTools();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("grep modes through tool-runner pipeline", () => {
  it("files_only result survives truncation with file paths intact", async () => {
    const results = await executeToolCalls(
      [{ type: "tool_use", id: "t1", name: "grep", input: { pattern: "pandas", path: TEST_DIR, files_only: true } }],
      5000,
      false,
    );
    expect(results).toHaveLength(1);
    expect(results[0].is_error).toBeUndefined();
    // All 15 .ts files should appear (they all contain "pandas")
    const lines = results[0].content.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(15);
    // No line-number content — just file paths
    expect(results[0].content).not.toMatch(/:\d+:/);
  });

  it("count_only result preserves total summary after truncation", async () => {
    const results = await executeToolCalls(
      [{ type: "tool_use", id: "t2", name: "grep", input: { pattern: "pandas", path: TEST_DIR, count_only: true } }],
      5000,
      false,
    );
    expect(results).toHaveLength(1);
    expect(results[0].is_error).toBeUndefined();
    expect(results[0].content).toContain("Total:");
    expect(results[0].content).toContain("matches in");
    // Should have 15 TS files (each with 1 match) — readme.md has no "pandas"
    expect(results[0].content).toContain("15 files");
  });

  it("files_only with file_glob filters correctly through pipeline", async () => {
    const results = await executeToolCalls(
      [{ type: "tool_use", id: "t3", name: "grep", input: { pattern: "pandas", path: TEST_DIR, files_only: true, file_glob: "*.ts" } }],
      5000,
      false,
    );
    expect(results).toHaveLength(1);
    expect(results[0].is_error).toBeUndefined();
    expect(results[0].content).not.toContain("readme.md");
    expect(results[0].content).toContain("module_0.ts");
  });

  it("grep error flows through tool-runner without retry (regex errors are not transient)", async () => {
    const results = await executeToolCalls(
      [{ type: "tool_use", id: "t4", name: "grep", input: { pattern: "[invalid", path: TEST_DIR } }],
      5000,
      false,
    );
    expect(results).toHaveLength(1);
    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Search error");
  });
});
