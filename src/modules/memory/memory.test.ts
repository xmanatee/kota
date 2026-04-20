import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#core/modules/provider-registry.js", () => ({
  getMemoryProvider: vi.fn(),
}));

import { getMemoryProvider } from "#core/modules/provider-registry.js";
import { runMemory } from "./memory.js";
import { MemoryStore } from "./store.js";

const mocked = vi.mocked(getMemoryProvider);

describe("runMemory", () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "kota-memtool-test-"));
    mocked.mockReturnValue(new MemoryStore(dir));
  });

  describe("save", () => {
    it("saves a memory and returns confirmation", async () => {
      const result = await runMemory({ action: "save", content: "User prefers dark mode" });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("Saved memory");
      expect(result.content).toContain("User prefers dark mode");
    });

    it("saves with tags", async () => {
      const result = await runMemory({
        action: "save",
        content: "Always use vitest",
        tags: ["testing", "preference"],
      });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("Saved memory");
    });

    it("returns error when content is missing", async () => {
      const result = await runMemory({ action: "save" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("content is required");
    });

    it("truncates long content in confirmation", async () => {
      const longContent = "A".repeat(200);
      const result = await runMemory({ action: "save", content: longContent });
      expect(result.content!.length).toBeLessThan(200);
    });
  });

  describe("search", () => {
    it("finds matching memories", async () => {
      await runMemory({ action: "save", content: "Project uses React and TypeScript" });
      await runMemory({ action: "save", content: "Deploy to AWS" });
      const result = await runMemory({ action: "search", query: "React" });
      expect(result.is_error).toBeUndefined();
      expect(result.content).toContain("React");
    });

    it("returns message when no matches", async () => {
      const result = await runMemory({ action: "search", query: "nonexistent-xyz" });
      expect(result.content).toBe("No matching memories found.");
    });

    it("returns error when query is missing", async () => {
      const result = await runMemory({ action: "search" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("query is required");
    });

    it("formats results with id and tags", async () => {
      await runMemory({
        action: "save",
        content: "Use vitest",
        tags: ["testing"],
      });
      const result = await runMemory({ action: "search", query: "vitest" });
      expect(result.content).toMatch(/\[.+\]/); // ID in brackets
      expect(result.content).toContain("testing");
    });

    it("uses semanticSearch when semantic search is requested and supported", async () => {
      const dir = mkdtempSync(join(tmpdir(), "kota-memtool-semantic-"));
      const store = new MemoryStore(dir);
      mocked.mockReturnValue(store);
      await runMemory({ action: "save", content: "Project uses React and TypeScript" });
      vi.spyOn(store, "supportsSemanticSearch").mockReturnValue(true);
      const semanticSearch = vi.spyOn(store, "semanticSearch").mockResolvedValue(store.list());

      const result = await runMemory({
        action: "search",
        query: "frontend framework",
        semantic: true,
        topK: 5,
      });

      expect(semanticSearch).toHaveBeenCalledWith(
        "frontend framework",
        5,
        { tag: undefined, since: undefined },
      );
      expect(result.is_error).toBeUndefined();
    });

    it("rejects semantic search when the active provider does not support it", async () => {
      const result = await runMemory({
        action: "search",
        query: "frontend framework",
        semantic: true,
      });

      expect(result.is_error).toBe(true);
      expect(result.content).toContain("requires an embedding-backed memory provider");
    });
  });

  describe("list", () => {
    it("returns message when empty", async () => {
      const result = await runMemory({ action: "list" });
      expect(result.content).toBe("No memories stored.");
    });

    it("shows count and content", async () => {
      await runMemory({ action: "save", content: "Memory one" });
      await runMemory({ action: "save", content: "Memory two" });
      const result = await runMemory({ action: "list" });
      expect(result.content).toContain("2 memories");
      expect(result.content).toContain("Memory one");
      expect(result.content).toContain("Memory two");
    });
  });

  describe("delete", () => {
    it("deletes an existing memory", async () => {
      const saveResult = await runMemory({ action: "save", content: "Delete me" });
      const id = saveResult.content!.match(/Saved memory (\w+):/)?.[1];
      expect(id).toBeTruthy();

      const result = await runMemory({ action: "delete", id });
      expect(result.content).toContain("Deleted memory");
      expect(result.is_error).toBeUndefined();
    });

    it("returns error for non-existent ID", async () => {
      const result = await runMemory({ action: "delete", id: "nonexistent" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("not found");
    });

    it("returns error when id is missing", async () => {
      const result = await runMemory({ action: "delete" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("id is required");
    });
  });

  it("returns error for unknown action", async () => {
    const result = await runMemory({ action: "bogus" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("unknown action");
  });
});
