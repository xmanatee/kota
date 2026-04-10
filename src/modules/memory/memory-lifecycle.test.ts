/**
 * Lifecycle integration test for the memory module using ModuleTestHarness.
 *
 * Exercises the KotaModule contract — load, tool call, dynamic state query,
 * and teardown — rather than testing internal helpers directly.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../memory/store.js";

vi.mock("../../memory/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../memory/store.js")>();
  return { ...actual, getMemoryStore: vi.fn() };
});

import { getMemoryStore } from "../../memory/store.js";
import { ModuleTestHarness } from "../../module-testing/index.js";
import memoryExtension from "./index.js";

const mocked = vi.mocked(getMemoryStore);

// Use a fresh in-memory store per test so memory entries don't bleed between tests
let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kota-mem-lifecycle-"));
  mocked.mockReturnValue(new MemoryStore(tempDir));
});

describe("memory module lifecycle (ModuleTestHarness)", () => {
  let harness: ModuleTestHarness;

  beforeEach(async () => {
    harness = await ModuleTestHarness.create(memoryExtension, { cwd: tempDir });
  });

  afterEach(async () => {
    await harness.teardown();
  });

  it("registers the memory tool on load", () => {
    const tool = harness.getTool("memory");
    expect(tool).toBeDefined();
    expect(tool?.tool.name).toBe("memory");
  });

  it("tool runner saves and retrieves a memory entry", async () => {
    const save = await harness.callTool("memory", {
      action: "save",
      content: "Harness test: always use vitest",
    });
    expect(save.is_error).toBeUndefined();
    expect(save.content).toContain("Saved memory");

    const search = await harness.callTool("memory", {
      action: "search",
      query: "vitest",
    });
    expect(search.is_error).toBeUndefined();
    expect(search.content).toContain("vitest");
  });

  it("tool runner returns error for unknown action", async () => {
    const result = await harness.callTool("memory", { action: "bogus" });
    expect(result.is_error).toBe(true);
  });

  it("throws when calling an unregistered tool", async () => {
    await expect(harness.callTool("nonexistent_tool", {})).rejects.toThrow(
      "not found",
    );
  });

  it("getDynamicState returns empty string (memory has no state provider)", () => {
    expect(harness.getDynamicState()).toBe("");
  });

  it("teardown completes without error (no onUnload on memory module)", async () => {
    await expect(harness.teardown()).resolves.toBeUndefined();
  });
});

describe("memory module — multiple load/teardown cycles", () => {
  it("can be loaded, torn down, and loaded again", async () => {
    const harness = new ModuleTestHarness(memoryExtension);

    await harness.load();
    expect(harness.getTool("memory")).toBeDefined();

    await harness.teardown();
    await harness.load();
    expect(harness.getTool("memory")).toBeDefined();

    await harness.teardown();
  });
});
