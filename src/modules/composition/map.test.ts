import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { clearCustomTools } from "#core/tools/index.js";
import filesystemModule from "#modules/filesystem/index.js";
import { runMap } from "./map.js";

function makeTempDir(suffix: string): string {
	const dir = join(tmpdir(), `kota-map-${suffix}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

beforeAll(async () => {
	const loader = new ModuleLoader({});
	await loader.loadAll([filesystemModule]);
});

afterAll(() => {
	clearCustomTools();
});

describe("map tool", () => {
	describe("validation", () => {
		it("rejects missing tool name", async () => {
			const r = await runMap({ items: [{}] });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("tool name is required");
		});

		it("rejects empty items array", async () => {
			const r = await runMap({ tool: "file_read", items: [] });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("must not be empty");
		});

		it("rejects missing items", async () => {
			const r = await runMap({ tool: "file_read" });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("must not be empty");
		});

		it("rejects too many items", async () => {
			const items = Array.from({ length: 51 }, (_, i) => ({ path: `f${i}` }));
			const r = await runMap({ tool: "file_read", items });
			expect(r.is_error).toBe(true);
			expect(r.content).toContain("max 50");
		});
	});

	describe("execution", () => {
		let testDir: string;

		beforeEach(() => {
			testDir = makeTempDir("exec");
			writeFileSync(join(testDir, "a.txt"), "alpha content", "utf-8");
			writeFileSync(join(testDir, "b.txt"), "beta content", "utf-8");
			writeFileSync(join(testDir, "c.txt"), "gamma content", "utf-8");
		});

		afterEach(() => {
			rmSync(testDir, { recursive: true, force: true });
		});

		it("applies file_read to multiple files", async () => {
			const r = await runMap({
				tool: "file_read",
				items: [
					{ path: join(testDir, "a.txt") },
					{ path: join(testDir, "b.txt") },
					{ path: join(testDir, "c.txt") },
				],
			});
			expect(r.is_error).toBeUndefined();
			expect(r.content).toContain("[map: 3 items | tool: file_read | 3 ok, 0 failed]");
			expect(r.content).toContain("alpha content");
			expect(r.content).toContain("beta content");
			expect(r.content).toContain("gamma content");
		});

		it("applies grep to multiple directories", { timeout: 15000 }, async () => {
			mkdirSync(join(testDir, "d1"), { recursive: true });
			mkdirSync(join(testDir, "d2"), { recursive: true });
			writeFileSync(join(testDir, "d1", "x.txt"), "hello world", "utf-8");
			writeFileSync(join(testDir, "d2", "y.txt"), "hello mars", "utf-8");

			const r = await runMap({
				tool: "grep",
				items: [
					{ pattern: "hello", path: join(testDir, "d1") },
					{ pattern: "hello", path: join(testDir, "d2") },
				],
			});
			expect(r.is_error).toBeUndefined();
			expect(r.content).toContain("2 ok, 0 failed");
			expect(r.content).toContain("x.txt");
			expect(r.content).toContain("y.txt");
		});

		it("handles partial failures gracefully", async () => {
			const r = await runMap({
				tool: "file_read",
				items: [
					{ path: join(testDir, "a.txt") },
					{ path: join(testDir, "nonexistent.txt") },
					{ path: join(testDir, "b.txt") },
				],
			});
			expect(r.is_error).toBeUndefined();
			expect(r.content).toContain("2 ok, 1 failed");
			expect(r.content).toContain("alpha content");
			expect(r.content).toContain("beta content");
			expect(r.content).toContain("Item 2 [ERR]");
		});

		it("handles unknown tool name", async () => {
			const r = await runMap({
				tool: "nonexistent_tool",
				items: [{ foo: "bar" }],
			});
			expect(r.is_error).toBeUndefined();
			expect(r.content).toContain("0 ok, 1 failed");
			expect(r.content).toContain("Unknown tool");
		});

		it("preserves item order in results", async () => {
			const r = await runMap({
				tool: "file_read",
				items: [
					{ path: join(testDir, "c.txt") },
					{ path: join(testDir, "a.txt") },
					{ path: join(testDir, "b.txt") },
				],
			});
			const item1Idx = r.content.indexOf("Item 1");
			const item2Idx = r.content.indexOf("Item 2");
			const item3Idx = r.content.indexOf("Item 3");
			expect(item1Idx).toBeLessThan(item2Idx);
			expect(item2Idx).toBeLessThan(item3Idx);

			const part1 = r.content.slice(item1Idx, item2Idx);
			const part2 = r.content.slice(item2Idx, item3Idx);
			expect(part1).toContain("gamma content");
			expect(part2).toContain("alpha content");
		});

		it("respects max_concurrent parameter", async () => {
			const r = await runMap({
				tool: "file_read",
				items: [
					{ path: join(testDir, "a.txt") },
					{ path: join(testDir, "b.txt") },
				],
				max_concurrent: 1,
			});
			expect(r.is_error).toBeUndefined();
			expect(r.content).toContain("2 ok");
		});

		it("clamps max_concurrent to 20", async () => {
			const r = await runMap({
				tool: "file_read",
				items: [{ path: join(testDir, "a.txt") }],
				max_concurrent: 100,
			});
			expect(r.is_error).toBeUndefined();
			expect(r.content).toContain("1 ok");
		});
	});

	describe("result truncation", () => {
		let testDir: string;

		beforeEach(() => {
			testDir = makeTempDir("trunc");
		});

		afterEach(() => {
			rmSync(testDir, { recursive: true, force: true });
		});

		it("truncates individual results when total would exceed budget", async () => {
			const bigContent = "x".repeat(20_000);
			writeFileSync(join(testDir, "big1.txt"), bigContent, "utf-8");
			writeFileSync(join(testDir, "big2.txt"), bigContent, "utf-8");

			const r = await runMap({
				tool: "file_read",
				items: [
					{ path: join(testDir, "big1.txt") },
					{ path: join(testDir, "big2.txt") },
				],
			});
			expect(r.is_error).toBeUndefined();
			expect(r.content).toContain("truncated");
		});
	});
});
