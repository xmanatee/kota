import { afterEach, describe, expect, it } from "vitest";
import {
	type CacheStats,
	createCacheMiddleware,
	getToolCache,
	resetToolCache,
	ToolCache,
} from "./tool-cache.js";
import type { ToolResult } from "./tools/index.js";

const ok = (content: string): ToolResult => ({ content });
const err = (content: string): ToolResult => ({ content, is_error: true });

describe("ToolCache", () => {
	it("caches deterministic read tool results", () => {
		const cache = new ToolCache();
		const result = ok("file contents");
		cache.set("file_read", { path: "/a.txt" }, result);
		expect(cache.get("file_read", { path: "/a.txt" })).toBe(result);
	});

	it("returns undefined for cache miss", () => {
		const cache = new ToolCache();
		expect(cache.get("file_read", { path: "/a.txt" })).toBeUndefined();
	});

	it("returns undefined for non-cacheable tools", () => {
		const cache = new ToolCache();
		cache.set("shell", { command: "ls" }, ok("output"));
		expect(cache.get("shell", { command: "ls" })).toBeUndefined();
	});

	it("does not cache error results", () => {
		const cache = new ToolCache();
		cache.set("file_read", { path: "/bad" }, err("not found"));
		expect(cache.get("file_read", { path: "/bad" })).toBeUndefined();
	});

	it("uses canonical key — input key order does not matter", () => {
		const cache = new ToolCache();
		cache.set("grep", { pattern: "foo", path: "/src" }, ok("match"));
		expect(cache.get("grep", { path: "/src", pattern: "foo" })).toEqual(ok("match"));
	});

	it("different inputs produce different cache entries", () => {
		const cache = new ToolCache();
		cache.set("file_read", { path: "/a.txt" }, ok("A"));
		cache.set("file_read", { path: "/b.txt" }, ok("B"));
		expect(cache.get("file_read", { path: "/a.txt" })?.content).toBe("A");
		expect(cache.get("file_read", { path: "/b.txt" })?.content).toBe("B");
	});

	it("invalidate clears all cached entries", () => {
		const cache = new ToolCache();
		cache.set("file_read", { path: "/a.txt" }, ok("A"));
		cache.set("grep", { pattern: "x" }, ok("found"));
		cache.invalidate();
		expect(cache.get("file_read", { path: "/a.txt" })).toBeUndefined();
		expect(cache.get("grep", { pattern: "x" })).toBeUndefined();
	});

	it("invalidate is a no-op on empty cache (no stat increment)", () => {
		const cache = new ToolCache();
		cache.invalidate();
		expect(cache.stats.invalidations).toBe(0);
	});

	it("tracks hits and misses", () => {
		const cache = new ToolCache();
		cache.set("file_read", { path: "/a" }, ok("A"));
		cache.get("file_read", { path: "/a" }); // hit
		cache.get("file_read", { path: "/a" }); // hit
		cache.get("file_read", { path: "/b" }); // miss
		expect(cache.stats).toEqual({
			hits: 2,
			misses: 1,
			invalidations: 0,
			size: 1,
		} satisfies CacheStats);
	});

	it("tracks invalidation count", () => {
		const cache = new ToolCache();
		cache.set("file_read", { path: "/a" }, ok("A"));
		cache.invalidate();
		cache.set("grep", { pattern: "x" }, ok("found"));
		cache.invalidate();
		expect(cache.stats.invalidations).toBe(2);
	});

	it("reset clears cache and stats", () => {
		const cache = new ToolCache();
		cache.set("file_read", { path: "/a" }, ok("A"));
		cache.get("file_read", { path: "/a" });
		cache.invalidate();
		cache.reset();
		expect(cache.stats).toEqual({
			hits: 0,
			misses: 0,
			invalidations: 0,
			size: 0,
		});
	});

	it("isMutating identifies write tools", () => {
		const cache = new ToolCache();
		expect(cache.isMutating("file_write")).toBe(true);
		expect(cache.isMutating("shell")).toBe(true);
		expect(cache.isMutating("file_read")).toBe(false);
		expect(cache.isMutating("ask_user")).toBe(false);
	});

	it("isCacheable identifies read tools", () => {
		const cache = new ToolCache();
		expect(cache.isCacheable("file_read")).toBe(true);
		expect(cache.isCacheable("grep")).toBe(true);
		expect(cache.isCacheable("glob")).toBe(true);
		expect(cache.isCacheable("shell")).toBe(false);
		expect(cache.isCacheable("ask_user")).toBe(false);
	});

	it("caches all expected cacheable tools", () => {
		const cache = new ToolCache();
		const tools = [
			"file_read", "grep", "glob", "repo_map",
			"files_overview", "read_document", "view_image",
		];
		for (const name of tools) {
			expect(cache.isCacheable(name)).toBe(true);
		}
	});

	it("recognizes all expected mutating tools", () => {
		const cache = new ToolCache();
		const tools = [
			"file_write", "file_edit", "multi_edit", "find_replace",
			"shell", "code_exec", "notebook", "process", "computer_use",
		];
		for (const name of tools) {
			expect(cache.isMutating(name)).toBe(true);
		}
	});
});

describe("createCacheMiddleware", () => {
	it("returns cached result without calling next", async () => {
		const cache = new ToolCache();
		const mw = createCacheMiddleware(cache);
		let nextCalled = 0;
		const next = async () => {
			nextCalled++;
			return ok("fresh");
		};

		// Prime the cache
		await mw({ name: "file_read", input: { path: "/a" } }, next);
		expect(nextCalled).toBe(1);

		// Should return cached without calling next
		const result = await mw({ name: "file_read", input: { path: "/a" } }, next);
		expect(result.content).toBe("fresh");
		expect(nextCalled).toBe(1); // still 1
		expect(cache.stats.hits).toBe(1);
	});

	it("passes through non-cacheable tools without caching", async () => {
		const cache = new ToolCache();
		const mw = createCacheMiddleware(cache);
		let nextCalled = 0;

		const result = await mw(
			{ name: "ask_user", input: { question: "hi" } },
			async () => { nextCalled++; return ok("answer"); },
		);

		expect(result.content).toBe("answer");
		expect(nextCalled).toBe(1);
		expect(cache.stats.size).toBe(0);
	});

	it("invalidates cache when mutating tool executes", async () => {
		const cache = new ToolCache();
		const mw = createCacheMiddleware(cache);

		// Prime with a read
		await mw(
			{ name: "file_read", input: { path: "/a" } },
			async () => ok("v1"),
		);
		expect(cache.stats.size).toBe(1);

		// Mutating tool should invalidate
		await mw(
			{ name: "file_write", input: { path: "/a", content: "new" } },
			async () => ok("written"),
		);
		expect(cache.stats.size).toBe(0);
		expect(cache.stats.invalidations).toBe(1);
	});

	it("re-reads after invalidation", async () => {
		const cache = new ToolCache();
		const mw = createCacheMiddleware(cache);
		let version = 1;

		const readNext = async () => ok(`v${version}`);
		const writeNext = async () => { version++; return ok("ok"); };

		// Read v1
		const r1 = await mw({ name: "file_read", input: { path: "/a" } }, readNext);
		expect(r1.content).toBe("v1");

		// Write (invalidates, increments version)
		await mw({ name: "file_edit", input: { path: "/a" } }, writeNext);

		// Read again — should get v2, not cached v1
		const r2 = await mw({ name: "file_read", input: { path: "/a" } }, readNext);
		expect(r2.content).toBe("v2");
	});

	it("does not cache error results from next", async () => {
		const cache = new ToolCache();
		const mw = createCacheMiddleware(cache);

		await mw(
			{ name: "file_read", input: { path: "/bad" } },
			async () => err("not found"),
		);
		expect(cache.stats.size).toBe(0);

		// Subsequent call should hit next again
		let called = false;
		await mw(
			{ name: "file_read", input: { path: "/bad" } },
			async () => { called = true; return ok("recovered"); },
		);
		expect(called).toBe(true);
	});

	it("shell command invalidates file_read cache", async () => {
		const cache = new ToolCache();
		const mw = createCacheMiddleware(cache);

		await mw({ name: "file_read", input: { path: "/a" } }, async () => ok("original"));
		await mw({ name: "shell", input: { command: "echo hi > /a" } }, async () => ok("done"));
		expect(cache.stats.size).toBe(0);
	});
});

describe("singleton", () => {
	afterEach(() => resetToolCache());

	it("getToolCache returns same instance", () => {
		const a = getToolCache();
		const b = getToolCache();
		expect(a).toBe(b);
	});

	it("resetToolCache creates fresh instance", () => {
		const a = getToolCache();
		a.set("file_read", { path: "/a" }, ok("A"));
		resetToolCache();
		const b = getToolCache();
		expect(b.stats.size).toBe(0);
	});
});
