import { afterEach, describe, expect, it } from "vitest";
import {
	clearAll,
	getEntry,
	getPersistentEntries,
	getWorkingMemoryState,
	listEntries,
	loadEntries,
	removeEntry,
	resetWorkingMemory,
	setEntry,
} from "../../memory/working-memory.js";

afterEach(() => {
	resetWorkingMemory();
});

describe("working memory store", () => {
	it("sets and gets entries", () => {
		expect(setEntry("goal", "Find all API endpoints")).toBeNull();
		const entry = getEntry("goal");
		expect(entry?.value).toBe("Find all API endpoints");
		expect(entry?.key).toBe("goal");
		expect(entry?.updatedAt).toBeGreaterThan(0);
	});

	it("overwrites existing entries", () => {
		setEntry("plan", "Step 1");
		setEntry("plan", "Step 1 done, Step 2");
		expect(getEntry("plan")?.value).toBe("Step 1 done, Step 2");
	});

	it("returns undefined for missing keys", () => {
		expect(getEntry("nonexistent")).toBeUndefined();
	});

	it("lists entries sorted by update time", () => {
		setEntry("a", "first");
		setEntry("b", "second");
		setEntry("c", "third");
		const entries = listEntries();
		expect(entries).toHaveLength(3);
		expect(entries[0].key).toBe("a");
		expect(entries[2].key).toBe("c");
	});

	it("removes entries", () => {
		setEntry("tmp", "value");
		expect(removeEntry("tmp")).toBe(true);
		expect(getEntry("tmp")).toBeUndefined();
	});

	it("returns false when removing nonexistent entry", () => {
		expect(removeEntry("nope")).toBe(false);
	});

	it("clears all entries and returns count", () => {
		setEntry("a", "1");
		setEntry("b", "2");
		expect(clearAll()).toBe(2);
		expect(listEntries()).toHaveLength(0);
	});

	it("returns 0 when clearing empty memory", () => {
		expect(clearAll()).toBe(0);
	});

	it("enforces max entry count", () => {
		for (let i = 0; i < 20; i++) {
			expect(setEntry(`k${i}`, "v")).toBeNull();
		}
		const err = setEntry("overflow", "v");
		expect(err).toContain("full");
	});

	it("allows overwrite when at max entries", () => {
		for (let i = 0; i < 20; i++) setEntry(`k${i}`, "v");
		// Overwriting existing key should succeed
		expect(setEntry("k0", "updated")).toBeNull();
		expect(getEntry("k0")?.value).toBe("updated");
	});

	it("enforces max value length", () => {
		const err = setEntry("big", "x".repeat(501));
		expect(err).toContain("500 chars");
	});

	it("enforces max key length", () => {
		const err = setEntry("k".repeat(81), "v");
		expect(err).toContain("80 chars");
	});

	it("enforces total size limit", () => {
		// Fill up close to 4000 chars
		for (let i = 0; i < 10; i++) {
			setEntry(`key${i}`, "x".repeat(390));
		}
		// Should fail — total already ~4000
		const err = setEntry("extra", "x".repeat(100));
		expect(err).toContain("total size limit");
	});

	it("sets persistent flag on entry", () => {
		setEntry("goal", "persist this", true);
		expect(getEntry("goal")?.persistent).toBe(true);
	});

	it("preserves persistent flag on overwrite without explicit flag", () => {
		setEntry("goal", "v1", true);
		setEntry("goal", "v2");
		expect(getEntry("goal")?.persistent).toBe(true);
		expect(getEntry("goal")?.value).toBe("v2");
	});

	it("can change persistent flag on overwrite", () => {
		setEntry("goal", "v1", true);
		setEntry("goal", "v2", false);
		expect(getEntry("goal")?.persistent).toBe(false);
	});

	it("defaults persistent to undefined for non-persistent entries", () => {
		setEntry("tmp", "session only");
		expect(getEntry("tmp")?.persistent).toBeUndefined();
	});
});

describe("loadEntries", () => {
	it("loads entries in bulk", () => {
		const count = loadEntries([
			{ key: "a", value: "1", updatedAt: 1000, persistent: true },
			{ key: "b", value: "2", updatedAt: 2000, persistent: true },
		]);
		expect(count).toBe(2);
		expect(getEntry("a")?.value).toBe("1");
		expect(getEntry("b")?.value).toBe("2");
	});

	it("skips entries that violate limits", () => {
		const count = loadEntries([
			{ key: "ok", value: "fine", updatedAt: 1000, persistent: true },
			{ key: "bad", value: "x".repeat(501), updatedAt: 2000, persistent: true },
		]);
		expect(count).toBe(1);
		expect(getEntry("ok")?.value).toBe("fine");
		expect(getEntry("bad")).toBeUndefined();
	});

	it("returns 0 for empty array", () => {
		expect(loadEntries([])).toBe(0);
	});
});

describe("getPersistentEntries", () => {
	it("returns only persistent entries", () => {
		setEntry("persist1", "a", true);
		setEntry("session1", "b");
		setEntry("persist2", "c", true);
		const persistent = getPersistentEntries();
		expect(persistent).toHaveLength(2);
		expect(persistent.map((e) => e.key).sort()).toEqual(["persist1", "persist2"]);
	});

	it("returns empty array when no persistent entries", () => {
		setEntry("tmp", "session only");
		expect(getPersistentEntries()).toHaveLength(0);
	});
});

describe("getWorkingMemoryState", () => {
	it("returns empty string when memory is empty", () => {
		expect(getWorkingMemoryState()).toBe("");
	});

	it("renders entries in working-memory tags", () => {
		setEntry("goal", "Find bugs");
		setEntry("finding", "3 issues in auth module");
		const state = getWorkingMemoryState();
		expect(state).toContain("<working-memory>");
		expect(state).toContain("</working-memory>");
		expect(state).toContain("**goal**: Find bugs");
		expect(state).toContain("**finding**: 3 issues in auth module");
	});

	it("marks persistent entries with star", () => {
		setEntry("persistent-item", "saved", true);
		setEntry("session-item", "temp");
		const state = getWorkingMemoryState();
		expect(state).toContain("**persistent-item**: saved ★");
		expect(state).not.toContain("**session-item**: temp ★");
	});
});

function makeMockStorage() {
	const data = new Map<string, unknown>();
	return {
		getJSON<T = unknown>(key: string): T | undefined {
			return data.get(`${key}.json`) as T | undefined;
		},
		setJSON(key: string, value: unknown): void {
			data.set(`${key}.json`, value);
		},
		delete(key: string): boolean {
			return data.delete(`${key}.json`) || data.delete(`${key}.txt`);
		},
		has(key: string): boolean {
			return data.has(`${key}.json`) || data.has(`${key}.txt`);
		},
		_data: data,
	};
}

function makeCtx(storage?: ReturnType<typeof makeMockStorage>) {
	return {
		cwd: "/tmp",
		verbose: false,
		config: {},
		storage: storage ?? makeMockStorage(),
		registerGroup: () => {},
		getRoutes: () => [],
		getContributedWorkflows: () => [],
  getContributedChannels: () => [],
		getModuleConfig: () => undefined,
		log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		getSecret: () => null,
		listTools: () => [],
		events: { emit: () => {} },
		createSession: () => ({ send: async () => "", close: () => {} }),
		registerProvider: () => {},
		getProvider: () => null,
		callTool: async () => ({ content: "" }),
		registerMiddleware: () => {},
		registerDynamicStateProvider: () => {},
	} as never;
}

describe("working-memory module tool", async () => {
	const { default: workingMemoryModule } = await import("./index.js");
	const ctx = makeCtx();

	const tools = typeof workingMemoryModule.tools === "function"
		? workingMemoryModule.tools(ctx)
		: workingMemoryModule.tools ?? [];
	const runner = tools[0].runner;

	it("write action stores entry", async () => {
		const result = await runner({ action: "write", key: "test", value: "hello" });
		expect(result.content).toContain("updated");
		expect(getEntry("test")?.value).toBe("hello");
	});

	it("write requires key and value", async () => {
		const r1 = await runner({ action: "write", value: "v" });
		expect(r1.is_error).toBe(true);
		const r2 = await runner({ action: "write", key: "k" });
		expect(r2.is_error).toBe(true);
	});

	it("read action returns entry", async () => {
		setEntry("item", "data");
		const result = await runner({ action: "read", key: "item" });
		expect(result.content).toContain("data");
	});

	it("read missing key returns error", async () => {
		const result = await runner({ action: "read", key: "missing" });
		expect(result.is_error).toBe(true);
	});

	it("list action shows all entries", async () => {
		setEntry("a", "1");
		setEntry("b", "2");
		const result = await runner({ action: "list" });
		expect(result.content).toContain("2 entries");
		expect(result.content).toContain("a: 1");
	});

	it("list empty memory", async () => {
		const result = await runner({ action: "list" });
		expect(result.content).toContain("empty");
	});

	it("remove action deletes entry", async () => {
		setEntry("del", "me");
		const result = await runner({ action: "remove", key: "del" });
		expect(result.content).toContain("Removed");
		expect(getEntry("del")).toBeUndefined();
	});

	it("clear action removes all entries", async () => {
		setEntry("x", "1");
		setEntry("y", "2");
		const result = await runner({ action: "clear" });
		expect(result.content).toContain("Cleared 2");
		expect(listEntries()).toHaveLength(0);
	});

	it("unknown action returns error", async () => {
		const result = await runner({ action: "invalid" });
		expect(result.is_error).toBe(true);
	});
});

describe("working-memory persistence via module tool", async () => {
	const { default: workingMemoryModule } = await import("./index.js");

	it("write with persist=true saves to storage", async () => {
		const storage = makeMockStorage();
		const ctx = makeCtx(storage);
		const tools = typeof workingMemoryModule.tools === "function"
			? workingMemoryModule.tools(ctx)
			: workingMemoryModule.tools ?? [];
		const runner = tools[0].runner;

		const result = await runner({ action: "write", key: "goal", value: "ship it", persist: true });
		expect(result.content).toContain("persistent");
		expect(getEntry("goal")?.persistent).toBe(true);
		expect(storage._data.has("entries.json")).toBe(true);
		const saved = storage.getJSON<Array<{ key: string }>>( "entries");
		expect(saved).toHaveLength(1);
		expect(saved?.[0].key).toBe("goal");
	});

	it("write without persist does not touch storage", async () => {
		const storage = makeMockStorage();
		const ctx = makeCtx(storage);
		const tools = typeof workingMemoryModule.tools === "function"
			? workingMemoryModule.tools(ctx)
			: workingMemoryModule.tools ?? [];
		const runner = tools[0].runner;

		await runner({ action: "write", key: "tmp", value: "session" });
		expect(storage._data.size).toBe(0);
	});

	it("remove persistent entry updates storage", async () => {
		const storage = makeMockStorage();
		const ctx = makeCtx(storage);
		const tools = typeof workingMemoryModule.tools === "function"
			? workingMemoryModule.tools(ctx)
			: workingMemoryModule.tools ?? [];
		const runner = tools[0].runner;

		await runner({ action: "write", key: "a", value: "1", persist: true });
		await runner({ action: "write", key: "b", value: "2", persist: true });
		await runner({ action: "remove", key: "a" });
		const saved = storage.getJSON<Array<{ key: string }>>("entries");
		expect(saved).toHaveLength(1);
		expect(saved?.[0].key).toBe("b");
	});

	it("clear removes persistent entries from storage", async () => {
		const storage = makeMockStorage();
		const ctx = makeCtx(storage);
		const tools = typeof workingMemoryModule.tools === "function"
			? workingMemoryModule.tools(ctx)
			: workingMemoryModule.tools ?? [];
		const runner = tools[0].runner;

		await runner({ action: "write", key: "p", value: "persist", persist: true });
		await runner({ action: "clear" });
		expect(storage._data.has("entries.json")).toBe(false);
	});

	it("list shows [persistent] tag for persistent entries", async () => {
		const storage = makeMockStorage();
		const ctx = makeCtx(storage);
		const tools = typeof workingMemoryModule.tools === "function"
			? workingMemoryModule.tools(ctx)
			: workingMemoryModule.tools ?? [];
		const runner = tools[0].runner;

		await runner({ action: "write", key: "saved", value: "yes", persist: true });
		await runner({ action: "write", key: "temp", value: "no" });
		const result = await runner({ action: "list" });
		expect(result.content).toContain("[persistent]");
		expect(result.content).toMatch(/temp: no(?!\s*\[persistent\])/);
	});

	it("read shows [persistent] tag for persistent entries", async () => {
		const storage = makeMockStorage();
		const ctx = makeCtx(storage);
		const tools = typeof workingMemoryModule.tools === "function"
			? workingMemoryModule.tools(ctx)
			: workingMemoryModule.tools ?? [];
		const runner = tools[0].runner;

		await runner({ action: "write", key: "data", value: "val", persist: true });
		const result = await runner({ action: "read", key: "data" });
		expect(result.content).toContain("[persistent]");
	});
});

describe("working-memory onLoad", async () => {
	const { default: workingMemoryModule } = await import("./index.js");

	it("loads persisted entries from storage on init", () => {
		const storage = makeMockStorage();
		storage.setJSON("entries", [
			{ key: "restored", value: "from disk", updatedAt: 1000 },
			{ key: "also-restored", value: "hello", updatedAt: 2000 },
		]);
		const ctx = makeCtx(storage);
		workingMemoryModule.onLoad?.(ctx);
		expect(getEntry("restored")?.value).toBe("from disk");
		expect(getEntry("restored")?.persistent).toBe(true);
		expect(getEntry("also-restored")?.value).toBe("hello");
	});

	it("does nothing when storage is empty", () => {
		const storage = makeMockStorage();
		const ctx = makeCtx(storage);
		workingMemoryModule.onLoad?.(ctx);
		expect(listEntries()).toHaveLength(0);
	});

	it("handles corrupted storage gracefully", () => {
		const storage = makeMockStorage();
		storage._data.set("entries.json", "not-an-array");
		const ctx = makeCtx(storage);
		workingMemoryModule.onLoad?.(ctx);
		expect(listEntries()).toHaveLength(0);
	});
});
