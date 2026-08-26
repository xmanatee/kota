import { afterEach, describe, expect, it } from "vitest";
import {
	getEntry,
	listEntries,
	resetWorkingMemory,
	setEntry,
} from "./store.js";

afterEach(() => {
	resetWorkingMemory();
});

function makeMockStorage() {
	const data = new Map<string, unknown>();
	return {
		getJSON(key: string): unknown | undefined {
			return data.get(`${key}.json`);
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
      getContributedUiSurfaces: () => [],
		getModuleConfig: () => undefined,
		log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		getSecret: () => null,
		listTools: () => [],
		events: { emit: () => {}, subscribe: () => () => {}, emitExternal: () => {}, subscribeExternal: () => () => {}, listenerCount: () => 0 },
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
		expect(storage.getJSON("entries")).toMatchObject({
			schemaVersion: 1,
			entries: [{ key: "goal" }],
		});
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
		expect(storage.getJSON("entries")).toMatchObject({
			entries: [{ key: "b" }],
		});
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
		expect(storage.getJSON("entries")).toMatchObject({ schemaVersion: 1 });
	});

	it("does nothing when storage is empty", () => {
		const storage = makeMockStorage();
		const ctx = makeCtx(storage);
		workingMemoryModule.onLoad?.(ctx);
		expect(listEntries()).toHaveLength(0);
	});

	it("reports corrupted storage instead of treating it as empty", () => {
		const storage = makeMockStorage();
		storage._data.set("entries.json", "not-an-array");
		const ctx = makeCtx(storage);
		expect(() => workingMemoryModule.onLoad?.(ctx)).toThrow(
			"Working memory storage has an unsupported or malformed schema",
		);
	});
});
