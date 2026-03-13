import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "./memory.js";

describe("MemoryStore", () => {
  let dir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kota-mem-test-"));
    store = new MemoryStore(dir);
  });

  it("starts empty", () => {
    expect(store.list()).toEqual([]);
  });

  it("saves and lists memories", () => {
    store.save("TypeScript project", ["lang"]);
    store.save("Uses vitest for testing", ["test"]);
    expect(store.list()).toHaveLength(2);
  });

  it("returns an ID on save", () => {
    const id = store.save("hello");
    expect(typeof id).toBe("string");
    expect(id.length).toBe(8); // 4 random bytes = 8 hex chars
  });

  it("deletes by ID", () => {
    const id = store.save("to delete");
    expect(store.delete(id)).toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it("returns false when deleting non-existent ID", () => {
    expect(store.delete("nonexistent")).toBe(false);
  });

  it("persists to disk and reloads", () => {
    store.save("persistent fact", ["important"]);
    const store2 = new MemoryStore(dir);
    expect(store2.list()).toHaveLength(1);
    expect(store2.list()[0].content).toBe("persistent fact");
  });

  describe("search", () => {
    beforeEach(() => {
      store.save("TypeScript is great for type safety", ["lang", "ts"]);
      store.save("Python is good for data science", ["lang", "python"]);
      store.save("Vitest runs fast TypeScript tests", ["test", "ts"]);
      store.save("React hooks simplify state", ["frontend"]);
    });

    it("returns all memories for empty query", () => {
      expect(store.search("")).toHaveLength(4);
    });

    it("finds by content keyword", () => {
      const results = store.search("TypeScript");
      expect(results.length).toBe(2);
    });

    it("finds by tag", () => {
      const results = store.search("python");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain("Python");
    });

    it("is case insensitive", () => {
      const results = store.search("typescript");
      expect(results.length).toBe(2);
    });

    it("ranks by term hit ratio", () => {
      // "TypeScript tests" should rank Vitest memory higher (matches both terms)
      const results = store.search("TypeScript tests");
      expect(results[0].content).toContain("Vitest");
    });

    it("returns empty for no matches", () => {
      expect(store.search("Golang")).toEqual([]);
    });

    it("matches across content and tags combined", () => {
      // "ts" appears in tags, "great" in content
      const results = store.search("ts great");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("auto-prune", () => {
    it("caps at 100 memories, keeping newest", () => {
      for (let i = 0; i < 105; i++) {
        store.save(`memory-${i}`);
      }
      const all = store.list();
      expect(all.length).toBe(100);
      // Should keep the last 100 (indices 5-104)
      expect(all[0].content).toBe("memory-5");
      expect(all[99].content).toBe("memory-104");
    });
  });
});
