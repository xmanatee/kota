import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SQLiteMemoryProvider } from "./sqlite-memory.js";

// Check if sqlite3 is available
let hasSqlite = false;
try {
	execFileSync("sqlite3", ["--version"], { stdio: "pipe" });
	hasSqlite = true;
} catch {
	// sqlite3 not available
}

const describeIfSqlite = hasSqlite ? describe : describe.skip;

describeIfSqlite("SQLiteMemoryProvider", () => {
	const testDir = join(tmpdir(), `kota-sqlite-mem-test-${Date.now()}`);
	let provider: SQLiteMemoryProvider;

	beforeAll(() => {
		if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
	});

	beforeEach(() => {
		// Fresh provider and DB per test
		const dir = join(testDir, `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(dir, { recursive: true });
		provider = new SQLiteMemoryProvider(dir);
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	// --- save ---

	it("saves a memory and returns an ID", () => {
		const id = provider.save("test memory");
		expect(id).toBeTruthy();
		expect(typeof id).toBe("string");
		expect(id.length).toBe(8); // 4 random bytes = 8 hex chars
	});

	it("saves memory with tags", () => {
		const id = provider.save("tagged memory", ["project", "important"]);
		const all = provider.list();
		const found = all.find((m) => m.id === id);
		expect(found).toBeDefined();
		expect(found?.tags).toEqual(["project", "important"]);
	});

	it("saves multiple memories with unique IDs", () => {
		const id1 = provider.save("first");
		const id2 = provider.save("second");
		const id3 = provider.save("third");
		expect(new Set([id1, id2, id3]).size).toBe(3);
	});

	// --- list ---

	it("lists all memories", () => {
		provider.save("one");
		provider.save("two");
		provider.save("three");
		const all = provider.list();
		expect(all.length).toBe(3);
	});

	it("returns empty array when no memories", () => {
		const all = provider.list();
		expect(all).toEqual([]);
	});

	it("memories have correct shape", () => {
		provider.save("test content", ["tag1"]);
		const all = provider.list();
		expect(all.length).toBe(1);
		const m = all[0];
		expect(m.id).toBeTruthy();
		expect(m.content).toBe("test content");
		expect(m.tags).toEqual(["tag1"]);
		expect(m.created).toBeTruthy();
		expect(new Date(m.created).getTime()).not.toBeNaN();
	});

	// --- search ---

	it("searches by keyword", () => {
		provider.save("I like apples");
		provider.save("I like oranges");
		provider.save("I like bananas");

		const results = provider.search("apples");
		expect(results.length).toBe(1);
		expect(results[0].content).toBe("I like apples");
	});

	it("searches by multiple keywords (AND)", () => {
		provider.save("red apple fruit");
		provider.save("red car fast");
		provider.save("green apple fruit");

		const results = provider.search("red apple");
		expect(results.length).toBe(1);
		expect(results[0].content).toBe("red apple fruit");
	});

	it("search is case-insensitive", () => {
		provider.save("TypeScript is great");
		const results = provider.search("typescript");
		expect(results.length).toBe(1);
	});

	it("searches by tag filter", () => {
		provider.save("note one", ["work"]);
		provider.save("note two", ["personal"]);
		provider.save("note three", ["work"]);

		const results = provider.search("note", { tag: "work" });
		expect(results.length).toBe(2);
	});

	it("searches with since filter", () => {
		provider.save("old memory");
		// All saved with current timestamp, so searching since "now - 1 hour" gets everything
		const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
		const results = provider.search("memory", { since: oneHourAgo });
		expect(results.length).toBe(1);

		// Searching since the future gets nothing
		const future = new Date(Date.now() + 3600 * 1000).toISOString();
		const futureResults = provider.search("memory", { since: future });
		expect(futureResults.length).toBe(0);
	});

	it("search returns empty when no matches", () => {
		provider.save("something unrelated");
		const results = provider.search("nonexistent");
		expect(results.length).toBe(0);
	});

	it("searches in tags too", () => {
		provider.save("generic content", ["important"]);
		const results = provider.search("important");
		expect(results.length).toBe(1);
	});

	// --- update ---

	it("updates memory content", () => {
		const id = provider.save("original content");
		const updated = provider.update(id, { content: "updated content" });
		expect(updated).toBe(true);

		const all = provider.list();
		const found = all.find((m) => m.id === id);
		expect(found?.content).toBe("updated content");
	});

	it("updates memory tags", () => {
		const id = provider.save("tagged", ["old"]);
		provider.update(id, { tags: ["new", "updated"] });

		const all = provider.list();
		const found = all.find((m) => m.id === id);
		expect(found?.tags).toEqual(["new", "updated"]);
	});

	it("update returns false for non-existent ID", () => {
		const result = provider.update("nonexistent", { content: "nope" });
		expect(result).toBe(false);
	});

	// --- delete ---

	it("deletes a memory by ID", () => {
		const id = provider.save("to delete");
		expect(provider.list().length).toBe(1);

		const deleted = provider.delete(id);
		expect(deleted).toBe(true);
		expect(provider.list().length).toBe(0);
	});

	it("delete returns false for non-existent ID", () => {
		expect(provider.delete("nonexistent")).toBe(false);
	});

	// --- special characters ---

	it("handles single quotes in content", () => {
		const id = provider.save("it's a test with 'quotes'");
		const all = provider.list();
		expect(all.find((m) => m.id === id)?.content).toBe("it's a test with 'quotes'");
	});

	it("handles special characters in tags", () => {
		const id = provider.save("special", ["tag'with'quotes", "tag\"with\"doubles"]);
		const all = provider.list();
		const found = all.find((m) => m.id === id);
		expect(found?.tags).toEqual(["tag'with'quotes", "tag\"with\"doubles"]);
	});

	it("handles newlines in content", () => {
		const id = provider.save("line1\nline2\nline3");
		const all = provider.list();
		expect(all.find((m) => m.id === id)?.content).toBe("line1\nline2\nline3");
	});

	// --- MemoryProvider interface conformance ---

	it("conforms to MemoryProvider interface", () => {
		expect(typeof provider.save).toBe("function");
		expect(typeof provider.search).toBe("function");
		expect(typeof provider.list).toBe("function");
		expect(typeof provider.update).toBe("function");
		expect(typeof provider.delete).toBe("function");
	});

	// --- persistence ---

	it("persists across provider instances", () => {
		const dir = join(testDir, `persist-${Date.now()}`);
		mkdirSync(dir, { recursive: true });

		const p1 = new SQLiteMemoryProvider(dir);
		p1.save("persistent memory", ["survives"]);

		const p2 = new SQLiteMemoryProvider(dir);
		const all = p2.list();
		expect(all.length).toBe(1);
		expect(all[0].content).toBe("persistent memory");
		expect(all[0].tags).toEqual(["survives"]);
	});

	// --- no arbitrary size limit ---

	it("stores more than 100 memories without pruning", () => {
		for (let i = 0; i < 110; i++) {
			provider.save(`memory ${i}`);
		}
		const all = provider.list();
		expect(all.length).toBe(110);
	});

	// --- getDbPath ---

	it("exposes database path", () => {
		expect(provider.getDbPath()).toContain("memory.db");
	});
});
