import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { resolveModuleSkills } from "#core/modules/module-types.js";
import sqliteMemoryModule from "./index.js";

let hasSqlite = false;
try {
	execFileSync("sqlite3", ["--version"], { stdio: "pipe" });
	hasSqlite = true;
} catch {}

const describeIfSqlite = hasSqlite ? describe : describe.skip;

function makeStubCtx(storageDir: string): ModuleContext {
	return {
		cwd: "/tmp/test",
		verbose: false,
		config: {} as ModuleContext["config"],
		storage: new ModuleStorage(storageDir, "sqlite-memory"),
		registerGroup: () => {},
		getRoutes: () => [],
		getContributedWorkflows: () => [],
		getContributedChannels: () => [],
		getModuleSummaries: () => [],
		getModuleConfig: () => undefined,
		log: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: () => {},
		},
		getSecret: () => null,
		listTools: () => [],
		events: { emit: () => {}, subscribe: () => () => {} },
		createSession: vi.fn(() => ({ send: vi.fn(async () => ""), close: vi.fn() })),
		registerProvider: vi.fn(),
		getProvider: () => null,
		callTool: async () => ({ content: "" }),
		registerMiddleware: () => {},
		registerDynamicStateProvider: () => {},
		registerCleanupHook: () => {},
		resolveAgentDef: () => undefined,
		resolveSkillsPrompt: () => "",
		probeHealthChecks: async () => ({}),
	};
}

describe("sqliteMemoryModule metadata", () => {
	it("has correct name, version, and dependencies", () => {
		expect(sqliteMemoryModule.name).toBe("sqlite-memory");
		expect(sqliteMemoryModule.version).toBe("1.0.0");
		expect(sqliteMemoryModule.description).toBeTruthy();
		expect(sqliteMemoryModule.dependencies).toEqual(["memory"]);
	});

	it("contributes a sqlite-memory skill", async () => {
		const ctx = makeStubCtx(tmpdir());
		const skills = await resolveModuleSkills(sqliteMemoryModule, ctx);
		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe("sqlite-memory");
		expect(skills[0].promptPath).toContain("sqlite-memory.md");
	});
});

describeIfSqlite("sqliteMemoryModule onLoad", () => {
	const testDir = join(tmpdir(), `kota-sqlite-mem-module-test-${Date.now()}`);

	beforeAll(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("registers a memory provider via ctx.registerProvider", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);

		sqliteMemoryModule.onLoad!(ctx);

		expect(ctx.registerProvider).toHaveBeenCalledTimes(1);
		expect(ctx.registerProvider).toHaveBeenCalledWith("memory", expect.any(Object));
	});

	it("registered provider implements MemoryProvider interface", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);

		sqliteMemoryModule.onLoad!(ctx);

		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];
		expect(typeof provider.save).toBe("function");
		expect(typeof provider.search).toBe("function");
		expect(typeof provider.list).toBe("function");
		expect(typeof provider.update).toBe("function");
		expect(typeof provider.delete).toBe("function");
	});

	it("save and list round-trip", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);

		sqliteMemoryModule.onLoad!(ctx);

		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];
		const id = provider.save("module integration test", ["test"]);
		expect(typeof id).toBe("string");
		expect(id.length).toBe(8);

		const results = provider.list();
		expect(results).toHaveLength(1);
		expect(results[0].content).toBe("module integration test");
	});

	it("update modifies content and tags", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);
		sqliteMemoryModule.onLoad!(ctx);
		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];

		const id = provider.save("original", ["old-tag"]);
		const updated = provider.update(id, { content: "revised", tags: ["new-tag"] });
		expect(updated).toBe(true);

		const all = provider.list();
		const entry = all.find((m: { id: string }) => m.id === id);
		expect(entry.content).toBe("revised");
		expect(entry.tags).toEqual(["new-tag"]);
	});

	it("update returns false for missing id", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);
		sqliteMemoryModule.onLoad!(ctx);
		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];

		expect(provider.update("no-such-id", { content: "x" })).toBe(false);
	});

	it("delete removes an entry", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);
		sqliteMemoryModule.onLoad!(ctx);
		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];

		const id = provider.save("to-delete");
		expect(provider.delete(id)).toBe(true);
		expect(provider.list()).toHaveLength(0);
	});

	it("delete returns false for missing id", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);
		sqliteMemoryModule.onLoad!(ctx);
		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];

		expect(provider.delete("no-such-id")).toBe(false);
	});

	it("search by keyword", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);
		sqliteMemoryModule.onLoad!(ctx);
		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];

		provider.save("apples are great", ["fruit"]);
		provider.save("oranges are fine", ["fruit"]);
		provider.save("cars are fast", ["vehicle"]);

		const results = provider.search("apples");
		expect(results).toHaveLength(1);
		expect(results[0].content).toBe("apples are great");
	});

	it("search by tag filter", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);
		sqliteMemoryModule.onLoad!(ctx);
		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];

		provider.save("work note", ["work"]);
		provider.save("personal note", ["personal"]);
		provider.save("another work note", ["work"]);

		const results = provider.search("note", { tag: "work" });
		expect(results).toHaveLength(2);
		expect(results.every((m: { tags: string[] }) => m.tags.includes("work"))).toBe(true);
	});

	it("search by since date", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);
		sqliteMemoryModule.onLoad!(ctx);
		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];

		provider.save("recent entry");
		const future = new Date(Date.now() + 3600_000).toISOString();
		expect(provider.search("entry", { since: future })).toHaveLength(0);

		const past = new Date(Date.now() - 3600_000).toISOString();
		expect(provider.search("entry", { since: past })).toHaveLength(1);
	});

	it("search returns empty on no match", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);
		sqliteMemoryModule.onLoad!(ctx);
		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];

		provider.save("something");
		expect(provider.search("nonexistent")).toHaveLength(0);
	});

	it("list returns empty on fresh store", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);
		sqliteMemoryModule.onLoad!(ctx);
		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];

		expect(provider.list()).toEqual([]);
	});

	it("duplicate content gets separate ids", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);
		sqliteMemoryModule.onLoad!(ctx);
		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];

		const id1 = provider.save("same content", ["tag"]);
		const id2 = provider.save("same content", ["tag"]);
		expect(id1).not.toBe(id2);
		expect(provider.list()).toHaveLength(2);
	});

	it("concurrent-style sequential operations stay consistent", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);
		sqliteMemoryModule.onLoad!(ctx);
		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];

		const ids: string[] = [];
		for (let i = 0; i < 20; i++) ids.push(provider.save(`entry-${i}`, [`batch`]));
		expect(provider.list()).toHaveLength(20);

		for (const id of ids.slice(0, 10)) provider.delete(id);
		expect(provider.list()).toHaveLength(10);

		for (const id of ids.slice(10)) provider.update(id, { content: "updated" });
		const remaining = provider.list();
		expect(remaining.every((m: { content: string }) => m.content === "updated")).toBe(true);
	});

	it("healthCheck returns healthy after load", async () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);

		sqliteMemoryModule.onLoad!(ctx);
		const result = await sqliteMemoryModule.healthCheck!();
		expect(result.status).toBe("healthy");
	});

	it("healthCheck returns healthy with existing db", async () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);
		sqliteMemoryModule.onLoad!(ctx);
		const provider = (ctx.registerProvider as ReturnType<typeof vi.fn>).mock.calls[0][1];
		provider.save("test entry");

		const result = await sqliteMemoryModule.healthCheck!();
		expect(result.status).toBe("healthy");
	});

	it("logs info message on load", () => {
		const dir = join(testDir, `run-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		const ctx = makeStubCtx(dir);

		sqliteMemoryModule.onLoad!(ctx);

		expect(ctx.log.info).toHaveBeenCalledWith(
			expect.stringContaining("SQLite memory provider"),
		);
	});
});
