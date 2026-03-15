import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory.js";
import { runMemory } from "./tools/memory.js";

/**
 * Cross-module integration tests for the memory pipeline.
 * Tests that tools/memory.ts and memory.ts work together correctly,
 * especially the iter-339 features: tag filtering, since filtering, update.
 */

// Use a real MemoryStore with a temp directory for each test
let tempDir: string;
let store: MemoryStore;

import { vi } from "vitest";
// We need to override getMemoryStore so runMemory uses our test store.
// Since getMemoryStore is a module-level singleton, we mock it.
import * as memoryModule from "./memory.js";

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kota-mem-pipeline-"));
  store = new MemoryStore(tempDir);
  vi.spyOn(memoryModule, "getMemoryStore").mockReturnValue(store);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("memory pipeline: tools/memory.ts → memory.ts", () => {
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

    it("tag filter is case-insensitive across the pipeline", async () => {
      await runMemory({ action: "save", content: "Sprint planning notes", tags: ["Work"] });
      const result = await runMemory({ action: "search", query: "sprint", tag: "work" });
      expect(result.content).toContain("Sprint planning notes");
    });
  });

  describe("save → search with since filter (cross-module)", () => {
    it("filters by creation date via since parameter", async () => {
      // Save a memory, then search with since in the future — should find nothing
      await runMemory({ action: "save", content: "Old meeting notes", tags: [] });
      const futureResult = await runMemory({
        action: "search",
        query: "meeting",
        since: "2099-01-01",
      });
      expect(futureResult.content).toBe("No matching memories found.");

      // Search with since in the past — should find it
      const pastResult = await runMemory({
        action: "search",
        query: "meeting",
        since: "2020-01-01",
      });
      expect(pastResult.content).toContain("Old meeting notes");
    });

    it("combined tag + since filters work through tool layer", async () => {
      await runMemory({ action: "save", content: "Work item A", tags: ["project"] });
      await runMemory({ action: "save", content: "Personal item B", tags: ["personal"] });

      // Both should exist when searching broadly
      const allResult = await runMemory({ action: "search", query: "item", since: "2020-01-01" });
      expect(allResult.content).toContain("Work item A");
      expect(allResult.content).toContain("Personal item B");

      // Filter by tag should narrow results
      const filtered = await runMemory({
        action: "search",
        query: "item",
        tag: "project",
        since: "2020-01-01",
      });
      expect(filtered.content).toContain("Work item A");
      expect(filtered.content).not.toContain("Personal item B");
    });
  });

  describe("save → update → search (cross-module lifecycle)", () => {
    it("update content flows through and is searchable", async () => {
      const saveResult = await runMemory({
        action: "save",
        content: "Budget: pending",
        tags: ["work"],
      });
      // Extract ID from save response
      const idMatch = saveResult.content.match(/Saved memory (\w+)/);
      expect(idMatch).not.toBeNull();
      const id = idMatch![1];

      // Update via tool layer
      const updateResult = await runMemory({
        action: "update",
        id,
        content: "Budget: approved $50k",
      });
      expect(updateResult.content).toContain(`Updated memory ${id}`);

      // Search should find updated content
      const searchResult = await runMemory({ action: "search", query: "approved" });
      expect(searchResult.content).toContain("approved $50k");

      // Old content should not match
      const oldSearch = await runMemory({ action: "search", query: "pending" });
      expect(oldSearch.content).toBe("No matching memories found.");
    });

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

  describe("full workflow: save → search → update → delete (end-to-end)", () => {
    it("exercises the complete personal assistant memory lifecycle", async () => {
      // Step 1: User saves a work note
      const save1 = await runMemory({
        action: "save",
        content: "Dashboard redesign kickoff scheduled for March 20",
        tags: ["project", "work"],
      });
      expect(save1.is_error).toBeUndefined();
      const id = save1.content.match(/Saved memory (\w+)/)![1];

      // Step 2: User asks "what do I have about the dashboard?"
      const search1 = await runMemory({
        action: "search",
        query: "dashboard",
        tag: "project",
      });
      expect(search1.content).toContain("Dashboard redesign kickoff");
      // Verify format includes timestamp and tags
      expect(search1.content).toMatch(/\[\w+\] \d{4}-\d{2}-\d{2} \(project, work\)/);

      // Step 3: User updates the note
      const update = await runMemory({
        action: "update",
        id,
        content: "Dashboard redesign: kickoff completed, next milestone April 5",
      });
      expect(update.content).toBe(`Updated memory ${id}`);

      // Step 4: Verify update is reflected in search
      const search2 = await runMemory({ action: "search", query: "dashboard" });
      expect(search2.content).toContain("next milestone April 5");
      expect(search2.content).not.toContain("scheduled for March 20");

      // Step 5: List shows the updated memory
      const list = await runMemory({ action: "list" });
      expect(list.content).toContain("1 memories:");
      expect(list.content).toContain("Dashboard redesign");

      // Step 6: Delete and verify gone
      const del = await runMemory({ action: "delete", id });
      expect(del.content).toBe(`Deleted memory ${id}`);

      const search3 = await runMemory({ action: "search", query: "dashboard" });
      expect(search3.content).toBe("No matching memories found.");
    });
  });

  describe("format contract: tool output matches store data shape", () => {
    it("search results include id, date, tags, and content", async () => {
      await runMemory({
        action: "save",
        content: "Test format contract",
        tags: ["alpha", "beta"],
      });

      const result = await runMemory({ action: "search", query: "format contract" });
      // Expected format: [<id>] <YYYY-MM-DD> (<tags>) <content>
      const lines = result.content.split("\n");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^\[\w+\] \d{4}-\d{2}-\d{2} \(alpha, beta\) Test format contract$/);
    });

    it("list results truncate long content at 80 chars", async () => {
      const longContent = "A".repeat(120);
      await runMemory({ action: "save", content: longContent, tags: [] });

      const result = await runMemory({ action: "list" });
      // List truncates to 80 chars
      expect(result.content).toContain("A".repeat(80));
      expect(result.content).not.toContain("A".repeat(81));
    });
  });
});
