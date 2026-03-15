import { mkdtempSync, } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
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

    it("filters by tag", () => {
      const results = store.search("", { tag: "frontend" });
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain("React");
    });

    it("tag filter is case-insensitive", () => {
      const results = store.search("", { tag: "LANG" });
      expect(results).toHaveLength(2);
    });

    it("combines tag filter with keyword search", () => {
      const results = store.search("TypeScript", { tag: "test" });
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain("Vitest");
    });

    it("filters by since date", () => {
      // All memories were just created, so a past date returns all
      const results = store.search("", { since: "2020-01-01" });
      expect(results).toHaveLength(4);
      // A future date returns none
      const none = store.search("", { since: "2099-01-01" });
      expect(none).toHaveLength(0);
    });

    it("combines tag and since filters", () => {
      const results = store.search("", { tag: "lang", since: "2020-01-01" });
      expect(results).toHaveLength(2);
    });

    it("ignores invalid since date", () => {
      const results = store.search("TypeScript", { since: "not-a-date" });
      expect(results).toHaveLength(2); // same as without filter
    });
  });

  describe("update", () => {
    it("updates content of existing memory", () => {
      const id = store.save("original content", ["tag1"]);
      expect(store.update(id, { content: "updated content" })).toBe(true);
      const mem = store.list().find((m) => m.id === id)!;
      expect(mem.content).toBe("updated content");
      expect(mem.tags).toEqual(["tag1"]); // tags unchanged
    });

    it("updates tags of existing memory", () => {
      const id = store.save("some content", ["old"]);
      store.update(id, { tags: ["new", "updated"] });
      const mem = store.list().find((m) => m.id === id)!;
      expect(mem.tags).toEqual(["new", "updated"]);
      expect(mem.content).toBe("some content"); // content unchanged
    });

    it("returns false for non-existent ID", () => {
      expect(store.update("nonexistent", { content: "x" })).toBe(false);
    });

    it("persists updates to disk", () => {
      const id = store.save("before", ["a"]);
      store.update(id, { content: "after", tags: ["b"] });
      const store2 = new MemoryStore(dir);
      const mem = store2.list().find((m) => m.id === id)!;
      expect(mem.content).toBe("after");
      expect(mem.tags).toEqual(["b"]);
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
