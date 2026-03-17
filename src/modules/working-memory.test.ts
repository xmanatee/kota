import { afterEach, describe, expect, it } from "vitest";
import {
	clearAll,
	getEntry,
	getWorkingMemoryState,
	listEntries,
	removeEntry,
	resetWorkingMemory,
	setEntry,
} from "../working-memory.js";

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
});

describe("working-memory module tool", async () => {
	const { default: workingMemoryModule } = await import("./working-memory.js");
	const ctx = {
		cwd: "/tmp",
		verbose: false,
		config: {},
		storage: {} as never,
		registerGroup: () => {},
		getRoutes: () => [],
		getModuleConfig: () => undefined,
		log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		getSecret: () => null,
		listTools: () => [],
		events: { emit: () => {}, on: () => () => {}, once: () => () => {} },
		createSession: () => ({ send: async () => "", close: () => {} }),
		registerProvider: () => {},
		getProvider: () => null,
		callTool: async () => ({ content: "" }),
	} as never;

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
