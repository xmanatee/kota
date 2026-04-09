import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ModuleLogStore,
	getModuleLogStore,
	initModuleLogStore,
	resetModuleLogStore,
} from "./module-log.js";

const tmpBase = join(process.env.TMPDIR || "/tmp", "kota-log-test");

beforeEach(() => {
	if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
	mkdirSync(tmpBase, { recursive: true });
	resetModuleLogStore();
});

afterEach(() => {
	if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
	resetModuleLogStore();
});

describe("ModuleLogStore", () => {
	it("appends and reads log entries", () => {
		const store = new ModuleLogStore(tmpBase);
		store.append("my-mod", "info", "hello world");
		store.append("my-mod", "error", "something broke");
		const entries = store.tail("my-mod");
		expect(entries).toHaveLength(2);
		expect(entries[0].level).toBe("info");
		expect(entries[0].msg).toBe("hello world");
		expect(entries[0].module).toBe("my-mod");
		expect(entries[1].level).toBe("error");
		expect(entries[1].msg).toBe("something broke");
	});

	it("includes structured data when provided", () => {
		const store = new ModuleLogStore(tmpBase);
		store.append("my-mod", "info", "step completed", { step: 1, tool: "web_fetch" });
		const entries = store.tail("my-mod");
		expect(entries[0].data).toEqual({ step: 1, tool: "web_fetch" });
	});

	it("omits data field when not provided", () => {
		const store = new ModuleLogStore(tmpBase);
		store.append("my-mod", "info", "no data");
		const entries = store.tail("my-mod");
		expect(entries[0].data).toBeUndefined();
	});

	it("returns empty for non-existent module", () => {
		const store = new ModuleLogStore(tmpBase);
		expect(store.tail("nonexistent")).toEqual([]);
	});

	it("tail returns last N entries", () => {
		const store = new ModuleLogStore(tmpBase);
		for (let i = 0; i < 10; i++) {
			store.append("my-mod", "info", `msg-${i}`);
		}
		const last3 = store.tail("my-mod", 3);
		expect(last3).toHaveLength(3);
		expect(last3[0].msg).toBe("msg-7");
		expect(last3[2].msg).toBe("msg-9");
	});

	it("query filters by module", () => {
		const store = new ModuleLogStore(tmpBase);
		store.append("mod-a", "info", "from a");
		store.append("mod-b", "info", "from b");
		const results = store.query({ module: "mod-a" });
		expect(results).toHaveLength(1);
		expect(results[0].module).toBe("mod-a");
	});

	it("query filters by level", () => {
		const store = new ModuleLogStore(tmpBase);
		store.append("my-mod", "info", "info msg");
		store.append("my-mod", "error", "error msg");
		store.append("my-mod", "debug", "debug msg");
		const errors = store.query({ module: "my-mod", level: "error" });
		expect(errors).toHaveLength(1);
		expect(errors[0].msg).toBe("error msg");
	});

	it("query filters by keyword", () => {
		const store = new ModuleLogStore(tmpBase);
		store.append("my-mod", "info", "weather check completed");
		store.append("my-mod", "info", "notification sent");
		const results = store.query({ module: "my-mod", keyword: "weather" });
		expect(results).toHaveLength(1);
		expect(results[0].msg).toContain("weather");
	});

	it("query searches keyword in data too", () => {
		const store = new ModuleLogStore(tmpBase);
		store.append("my-mod", "info", "step done", { tool: "web_fetch" });
		store.append("my-mod", "info", "step done", { tool: "notify" });
		const results = store.query({ module: "my-mod", keyword: "web_fetch" });
		expect(results).toHaveLength(1);
	});

	it("query filters by since timestamp", () => {
		const store = new ModuleLogStore(tmpBase);
		// Write entries with explicit different timestamps via raw JSONL
		const dir = join(tmpBase, ".kota", "modules", "my-mod");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "logs.jsonl"),
			'{"ts":"2025-01-01T00:00:00Z","level":"info","module":"my-mod","msg":"old entry"}\n' +
			'{"ts":"2025-06-01T00:00:00Z","level":"info","module":"my-mod","msg":"new entry"}\n',
		);
		const results = store.query({ module: "my-mod", since: "2025-03-01T00:00:00Z" });
		expect(results).toHaveLength(1);
		expect(results[0].msg).toBe("new entry");
	});

	it("query respects limit", () => {
		const store = new ModuleLogStore(tmpBase);
		for (let i = 0; i < 20; i++) {
			store.append("my-mod", "info", `msg-${i}`);
		}
		const results = store.query({ module: "my-mod", limit: 5 });
		expect(results).toHaveLength(5);
	});

	it("query returns newest first", () => {
		const store = new ModuleLogStore(tmpBase);
		// Write entries with explicit different timestamps to ensure ordering
		const dir = join(tmpBase, ".kota", "modules", "my-mod");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "logs.jsonl"),
			'{"ts":"2025-01-01T00:00:00Z","level":"info","module":"my-mod","msg":"first"}\n' +
			'{"ts":"2025-06-01T00:00:00Z","level":"info","module":"my-mod","msg":"second"}\n',
		);
		const results = store.query({ module: "my-mod" });
		expect(results[0].msg).toBe("second");
		expect(results[1].msg).toBe("first");
	});

	it("query across all modules when no module specified", () => {
		const store = new ModuleLogStore(tmpBase);
		store.append("mod-a", "info", "from a");
		store.append("mod-b", "error", "from b");
		const results = store.query({});
		expect(results).toHaveLength(2);
	});

	it("modules() lists modules with logs", () => {
		const store = new ModuleLogStore(tmpBase);
		store.append("mod-a", "info", "msg");
		store.append("mod-b", "info", "msg");
		const exts = store.modules();
		expect(exts).toContain("mod-a");
		expect(exts).toContain("mod-b");
	});

	it("modules() returns empty when no logs", () => {
		const store = new ModuleLogStore(tmpBase);
		expect(store.modules()).toEqual([]);
	});

	it("clear() removes module logs", () => {
		const store = new ModuleLogStore(tmpBase);
		store.append("my-mod", "info", "will be cleared");
		expect(store.clear("my-mod")).toBe(true);
		expect(store.tail("my-mod")).toEqual([]);
		expect(store.modules()).not.toContain("my-mod");
	});

	it("clear() returns false for non-existent module", () => {
		const store = new ModuleLogStore(tmpBase);
		expect(store.clear("nonexistent")).toBe(false);
	});

	it("prunes when exceeding max entries", () => {
		const store = new ModuleLogStore(tmpBase);
		for (let i = 0; i < 1010; i++) {
			store.append("my-mod", "info", `msg-${i}`);
		}
		const entries = store.tail("my-mod", 2000);
		expect(entries.length).toBeLessThanOrEqual(760);
		expect(entries.length).toBeGreaterThanOrEqual(740);
	});

	it("handles corrupted log lines gracefully", () => {
		const store = new ModuleLogStore(tmpBase);
		const dir = join(tmpBase, ".kota", "modules", "bad-mod");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "logs.jsonl"),
			'{"ts":"2025-01-01","level":"info","module":"bad-mod","msg":"good"}\nnot json\n{"ts":"2025-01-02","level":"error","module":"bad-mod","msg":"also good"}\n',
		);
		const entries = store.tail("bad-mod");
		expect(entries).toHaveLength(2);
		expect(entries[0].msg).toBe("good");
		expect(entries[1].msg).toBe("also good");
	});

	it("sets timestamps automatically", () => {
		const store = new ModuleLogStore(tmpBase);
		const before = new Date().toISOString();
		store.append("my-mod", "info", "timestamped");
		const entries = store.tail("my-mod");
		expect(entries[0].ts >= before).toBe(true);
	});
});

describe("ModuleLogStore singleton", () => {
	it("initModuleLogStore creates singleton", () => {
		expect(getModuleLogStore()).toBeNull();
		initModuleLogStore(tmpBase);
		expect(getModuleLogStore()).toBeInstanceOf(ModuleLogStore);
	});

	it("resetModuleLogStore clears singleton", () => {
		initModuleLogStore(tmpBase);
		expect(getModuleLogStore()).not.toBeNull();
		resetModuleLogStore();
		expect(getModuleLogStore()).toBeNull();
	});
});
