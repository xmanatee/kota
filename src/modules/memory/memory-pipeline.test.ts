import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMemory } from "#modules/memory/memory.js";
import { MemoryStore } from "#modules/memory/store.js";

/**
 * Cross-module integration tests for the memory pipeline.
 * Tests that modules/memory/memory.ts and memory/store.ts work together correctly,
 * especially the iter-339 features: tag filtering, since filtering, update.
 */

vi.mock("#core/modules/provider-registry.js", () => ({
  getMemoryProvider: vi.fn(),
}));

import { getMemoryProvider } from "#core/modules/provider-registry.js";

const mockedProvider = vi.mocked(getMemoryProvider);

// Use a real MemoryStore with a temp directory for each test
let tempDir: string;
let store: MemoryStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kota-mem-pipeline-"));
  store = new MemoryStore(tempDir);
  mockedProvider.mockReturnValue(store);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("memory pipeline: modules/memory/memory.ts → memory/store.ts", () => {
  describe("save → search with tag filter (cross-module)", () => {
    it("saves with tags and retrieves by tag filter", async () => {
      // Save two memories with different tags via tool layer
      await runMemory({ action: "save", content: "Q2 budget approved", tags: ["work"] });
      await runMemory({ action: "save", content: "Buy groceries", tags: ["personal"] });

      // Search with tag filter — should only find work-tagged
      const result = await runMemory({ action: "search", query: "budget", tag: "work" });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("Q2 budget approved");
      expect(result.content).not.toContain("groceries");
    });
  });

  describe("save → update → search (cross-module lifecycle)", () => {

    it("update tags changes search filter results", async () => {
      const saveResult = await runMemory({
        action: "save",
        content: "Quarterly review",
        tags: ["meeting"],
      });
      const id = saveResult.content.match(/Saved memory (\w+)/)![1];

      // Initially searchable by 'meeting' tag
      let result = await runMemory({ action: "search", query: "review", tag: "meeting" });
      expect(result.content).toContain("Quarterly review");

      // Update tags to 'work'
      await runMemory({ action: "update", id, tags: ["work"] });

      // No longer found under 'meeting' tag
      result = await runMemory({ action: "search", query: "review", tag: "meeting" });
      expect(result.content).toBe("No matching memories found.");

      // Found under 'work' tag
      result = await runMemory({ action: "search", query: "review", tag: "work" });
      expect(result.content).toContain("Quarterly review");
    });
  });
});
