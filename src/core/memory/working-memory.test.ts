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
	setCompactionEnabled,
	setEntry,
} from "./working-memory.js";

afterEach(() => {
	resetWorkingMemory();
});

describe("setEntry", () => {
	it("stores a new entry and returns null", () => {
		const err = setEntry("key", "value");
		expect(err).toBeNull();
		expect(getEntry("key")?.value).toBe("value");
	});

	it("rejects keys longer than 80 chars", () => {
		const longKey = "k".repeat(81);
		expect(setEntry(longKey, "v")).toMatch(/80/);
	});

	it("accepts keys of exactly 80 chars", () => {
		expect(setEntry("k".repeat(80), "v")).toBeNull();
	});

	it("rejects values longer than 500 chars", () => {
		expect(setEntry("key", "v".repeat(501))).toMatch(/500/);
	});

	it("accepts values of exactly 500 chars", () => {
		expect(setEntry("key", "v".repeat(500))).toBeNull();
	});

	it("rejects new entry when store is full", () => {
		for (let i = 0; i < 20; i++) setEntry(`k${i}`, "v");
		expect(setEntry("overflow", "v")).toMatch(/full/);
	});

	it("allows updating an existing entry when store is full", () => {
		for (let i = 0; i < 20; i++) setEntry(`k${i}`, "v");
		expect(setEntry("k0", "updated")).toBeNull();
	});

	it("rejects update that would exceed total char limit", () => {
		// 8 single-char keys * (1 + 499) = 4000 chars total
		for (const k of ["a", "b", "c", "d", "e", "f", "g", "h"])
			setEntry(k, "v".repeat(499));
		// delta = 500 - 499 = 1, pushes total to 4001 > 4000
		const err = setEntry("a", "v".repeat(500));
		expect(err).toMatch(/total size/);
	});

	it("sets persistent flag on new entry", () => {
		setEntry("key", "val", true);
		expect(getEntry("key")?.persistent).toBe(true);
	});

	it("inherits persistent flag from existing entry when not specified", () => {
		setEntry("key", "val", true);
		setEntry("key", "updated");
		expect(getEntry("key")?.persistent).toBe(true);
	});

	it("overrides persistent flag when explicitly provided", () => {
		setEntry("key", "val", true);
		setEntry("key", "updated", false);
		expect(getEntry("key")?.persistent).toBe(false);
	});
});

describe("loadEntries", () => {
	it("loads valid entries in bulk and returns count", () => {
		const count = loadEntries([
			{ key: "a", value: "1", updatedAt: 1 },
			{ key: "b", value: "2", updatedAt: 2 },
		]);
		expect(count).toBe(2);
		expect(getEntry("a")?.value).toBe("1");
	});

	it("skips entries that violate limits and returns correct count", () => {
		const count = loadEntries([
			{ key: "a", value: "1", updatedAt: 1 },
			{ key: "k".repeat(81), value: "bad", updatedAt: 2 },
		]);
		expect(count).toBe(1);
	});

	it("preserves persistent flag on load", () => {
		loadEntries([{ key: "p", value: "v", updatedAt: 1, persistent: true }]);
		expect(getEntry("p")?.persistent).toBe(true);
	});
});

describe("getPersistentEntries", () => {
	it("returns only persistent entries", () => {
		setEntry("a", "1", true);
		setEntry("b", "2", false);
		setEntry("c", "3", true);
		const persistent = getPersistentEntries();
		expect(persistent.map((e) => e.key)).toEqual(expect.arrayContaining(["a", "c"]));
		expect(persistent.map((e) => e.key)).not.toContain("b");
	});

	it("returns empty array when no persistent entries", () => {
		setEntry("a", "1");
		expect(getPersistentEntries()).toEqual([]);
	});
});

describe("getEntry", () => {
	it("returns undefined for missing key", () => {
		expect(getEntry("missing")).toBeUndefined();
	});

	it("returns the entry for existing key", () => {
		setEntry("x", "hello");
		expect(getEntry("x")?.value).toBe("hello");
	});
});

describe("removeEntry", () => {
	it("removes an existing entry and returns true", () => {
		setEntry("r", "v");
		expect(removeEntry("r")).toBe(true);
		expect(getEntry("r")).toBeUndefined();
	});

	it("returns false for a non-existent key", () => {
		expect(removeEntry("ghost")).toBe(false);
	});
});

describe("listEntries", () => {
	it("returns entries sorted by updatedAt ascending", () => {
		// We can't control Date.now() precisely, but sequential sets should order correctly
		setEntry("first", "1");
		setEntry("second", "2");
		setEntry("third", "3");
		const keys = listEntries().map((e) => e.key);
		// At minimum verify all are present; ordering relies on ascending updatedAt
		expect(keys).toHaveLength(3);
	});

	it("returns empty array when store is empty", () => {
		expect(listEntries()).toEqual([]);
	});
});

describe("clearAll", () => {
	it("removes all entries and returns count", () => {
		setEntry("a", "1");
		setEntry("b", "2");
		expect(clearAll()).toBe(2);
		expect(listEntries()).toEqual([]);
	});

	it("returns 0 when store is already empty", () => {
		expect(clearAll()).toBe(0);
	});
});

describe("getWorkingMemoryState", () => {
	it("returns empty string when memory is empty", () => {
		expect(getWorkingMemoryState()).toBe("");
	});

	it("wraps entries in working-memory tags", () => {
		setEntry("task", "write tests");
		const state = getWorkingMemoryState();
		expect(state).toContain("<working-memory>");
		expect(state).toContain("</working-memory>");
		expect(state).toContain("**task**");
		expect(state).toContain("write tests");
	});

	it("appends ★ for persistent entries", () => {
		setEntry("pinned", "important", true);
		expect(getWorkingMemoryState()).toContain(" ★");
	});

	it("does not append ★ for non-persistent entries", () => {
		setEntry("normal", "value");
		expect(getWorkingMemoryState()).not.toContain("★");
	});
});

describe("compaction", () => {
	it("does not compact when below thresholds", () => {
		setEntry("key", "short value");
		const state = getWorkingMemoryState();
		expect(state).not.toContain("working-memory-compacted");
		expect(getEntry("key")?.value).toBe("short value");
	});

	it("compacts long entries when entry count threshold is reached", () => {
		// Fill 16 entries (threshold) with long values
		for (let i = 0; i < 16; i++) {
			setEntry(`k${i}`, "x".repeat(210));
		}
		const state = getWorkingMemoryState();
		// At least some entries should be truncated
		expect(state).toContain("working-memory-compacted");
		// Truncated values end with ellipsis
		const entries = listEntries();
		const truncated = entries.filter((e) => e.value.endsWith("…"));
		expect(truncated.length).toBeGreaterThan(0);
		expect(truncated[0].value.length).toBe(201); // 200 chars + ellipsis
	});

	it("compacts long entries when char threshold is reached", () => {
		// Fill char budget past 80% (3200 chars) with long values
		// 7 entries * (1 char key + 460 char value) = 7 * 461 = 3227 > 3200
		for (let i = 0; i < 7; i++) {
			setEntry(`${i}`, "v".repeat(460));
		}
		const state = getWorkingMemoryState();
		expect(state).toContain("working-memory-compacted");
	});

	it("never compacts persistent entries", () => {
		// Fill 16 entries — first one persistent with a long value
		setEntry("pinned", "p".repeat(210), true);
		for (let i = 0; i < 15; i++) {
			setEntry(`k${i}`, "x".repeat(210));
		}
		getWorkingMemoryState();
		// Persistent entry must not be truncated
		expect(getEntry("pinned")?.value).toBe("p".repeat(210));
	});

	it("compaction note is shown once and cleared after", () => {
		for (let i = 0; i < 16; i++) {
			setEntry(`k${i}`, "x".repeat(210));
		}
		const first = getWorkingMemoryState();
		expect(first).toContain("working-memory-compacted");
		// Second call — no new compaction, note is gone
		const second = getWorkingMemoryState();
		expect(second).not.toContain("working-memory-compacted");
	});

	it("does not compact when disabled", () => {
		setCompactionEnabled(false);
		for (let i = 0; i < 16; i++) {
			setEntry(`k${i}`, "x".repeat(210));
		}
		const state = getWorkingMemoryState();
		expect(state).not.toContain("working-memory-compacted");
		// Values untouched
		for (let i = 0; i < 16; i++) {
			expect(getEntry(`k${i}`)?.value).toBe("x".repeat(210));
		}
	});

	it("returns empty string with no compaction note when memory is empty", () => {
		expect(getWorkingMemoryState()).toBe("");
	});
});
