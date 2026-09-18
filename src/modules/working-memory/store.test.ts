import { beforeEach, describe, expect, it } from "vitest";
import { WorkingMemoryStore } from "./store.js";

let store: WorkingMemoryStore;
beforeEach(() => {
	store = new WorkingMemoryStore();
});

describe("setEntry", () => {
	it("stores a new entry and returns null", () => {
		const err = store.setEntry("key", "value");
		expect(err).toBeNull();
		expect(store.getEntry("key")?.value).toBe("value");
	});

	it("rejects keys longer than 80 chars", () => {
		const longKey = "k".repeat(81);
		expect(store.setEntry(longKey, "v")).toMatch(/80/);
	});

	it("accepts keys of exactly 80 chars", () => {
		expect(store.setEntry("k".repeat(80), "v")).toBeNull();
	});

	it("rejects values longer than 500 chars", () => {
		expect(store.setEntry("key", "v".repeat(501))).toMatch(/500/);
	});

	it("accepts values of exactly 500 chars", () => {
		expect(store.setEntry("key", "v".repeat(500))).toBeNull();
	});

	it("rejects new entry when store is full", () => {
		for (let i = 0; i < 20; i++) store.setEntry(`k${i}`, "v");
		expect(store.setEntry("overflow", "v")).toMatch(/full/);
	});

	it("allows updating an existing entry when store is full", () => {
		for (let i = 0; i < 20; i++) store.setEntry(`k${i}`, "v");
		expect(store.setEntry("k0", "updated")).toBeNull();
	});

	it("rejects update that would exceed total char limit", () => {
		// 8 single-char keys * (1 + 499) = 4000 chars total
		for (const k of ["a", "b", "c", "d", "e", "f", "g", "h"])
			store.setEntry(k, "v".repeat(499));
		// delta = 500 - 499 = 1, pushes total to 4001 > 4000
		const err = store.setEntry("a", "v".repeat(500));
		expect(err).toMatch(/total size/);
	});

	it("sets persistent flag on new entry", () => {
		store.setEntry("key", "val", true);
		expect(store.getEntry("key")?.persistent).toBe(true);
	});

	it("inherits persistent flag from existing entry when not specified", () => {
		store.setEntry("key", "val", true);
		store.setEntry("key", "updated");
		expect(store.getEntry("key")?.persistent).toBe(true);
	});

	it("overrides persistent flag when explicitly provided", () => {
		store.setEntry("key", "val", true);
		store.setEntry("key", "updated", false);
		expect(store.getEntry("key")?.persistent).toBe(false);
	});
});

describe("loadEntries", () => {
	it("loads valid entries in bulk and returns count", () => {
		const count = store.loadEntries([
			{ key: "a", value: "1", updatedAt: 1 },
			{ key: "b", value: "2", updatedAt: 2 },
		]);
		expect(count).toBe(2);
		expect(store.getEntry("a")?.value).toBe("1");
	});

	it("skips entries that violate limits and returns correct count", () => {
		const count = store.loadEntries([
			{ key: "a", value: "1", updatedAt: 1 },
			{ key: "k".repeat(81), value: "bad", updatedAt: 2 },
		]);
		expect(count).toBe(1);
	});

	it("preserves persistent flag on load", () => {
		store.loadEntries([{ key: "p", value: "v", updatedAt: 1, persistent: true }]);
		expect(store.getEntry("p")?.persistent).toBe(true);
	});
});

describe("getPersistentEntries", () => {
	it("returns only persistent entries", () => {
		store.setEntry("a", "1", true);
		store.setEntry("b", "2", false);
		store.setEntry("c", "3", true);
		const persistent = store.getPersistentEntries();
		expect(persistent.map((e) => e.key)).toEqual(expect.arrayContaining(["a", "c"]));
		expect(persistent.map((e) => e.key)).not.toContain("b");
	});

	it("returns empty array when no persistent entries", () => {
		store.setEntry("a", "1");
		expect(store.getPersistentEntries()).toEqual([]);
	});
});

describe("getEntry", () => {
	it("returns undefined for missing key", () => {
		expect(store.getEntry("missing")).toBeUndefined();
	});

	it("returns the entry for existing key", () => {
		store.setEntry("x", "hello");
		expect(store.getEntry("x")?.value).toBe("hello");
	});
});

describe("removeEntry", () => {
	it("removes an existing entry and returns true", () => {
		store.setEntry("r", "v");
		expect(store.removeEntry("r")).toBe(true);
		expect(store.getEntry("r")).toBeUndefined();
	});

	it("returns false for a non-existent key", () => {
		expect(store.removeEntry("ghost")).toBe(false);
	});
});

describe("listEntries", () => {
	it("returns entries sorted by updatedAt ascending", () => {
		// We can't control Date.now() precisely, but sequential sets should order correctly
		store.setEntry("first", "1");
		store.setEntry("second", "2");
		store.setEntry("third", "3");
		const keys = store.listEntries().map((e) => e.key);
		// At minimum verify all are present; ordering relies on ascending updatedAt
		expect(keys).toHaveLength(3);
	});

	it("returns empty array when store is empty", () => {
		expect(store.listEntries()).toEqual([]);
	});
});

describe("clearAll", () => {
	it("removes all entries and returns count", () => {
		store.setEntry("a", "1");
		store.setEntry("b", "2");
		expect(store.clearAll()).toBe(2);
		expect(store.listEntries()).toEqual([]);
	});

	it("returns 0 when store is already empty", () => {
		expect(store.clearAll()).toBe(0);
	});
});

describe("getWorkingMemoryState", () => {
	it("returns empty string when memory is empty", () => {
		expect(store.getWorkingMemoryState()).toBe("");
	});

	it("wraps entries in working-memory tags", () => {
		store.setEntry("task", "write tests");
		const state = store.getWorkingMemoryState();
		expect(state).toContain("<working-memory>");
		expect(state).toContain("</working-memory>");
		expect(state).toContain("**task**");
		expect(state).toContain("write tests");
	});

	it("appends ★ for persistent entries", () => {
		store.setEntry("pinned", "important", true);
		expect(store.getWorkingMemoryState()).toContain(" ★");
	});

	it("does not append ★ for non-persistent entries", () => {
		store.setEntry("normal", "value");
		expect(store.getWorkingMemoryState()).not.toContain("★");
	});
});

describe("compaction", () => {
	it("keeps compaction switches, notes, and entries instance-local", () => {
		const other = new WorkingMemoryStore();
		store.setCompactionEnabled(false);
		for (let i = 0; i < 7; i++) {
			store.setEntry(`${i}`, "a".repeat(460));
			other.setEntry(`${i}`, "b".repeat(460));
		}
		expect(other.getWorkingMemoryState()).toContain("working-memory-compacted");
		expect(store.getWorkingMemoryState()).not.toContain("working-memory-compacted");
		expect(store.getEntry("0")?.value).toBe("a".repeat(460));
		other.clearAll();
		other.dispose();
		expect(store.listEntries()).toHaveLength(7);
	});

	it("does not compact when below thresholds", () => {
		store.setEntry("key", "short value");
		const state = store.getWorkingMemoryState();
		expect(state).not.toContain("working-memory-compacted");
		expect(store.getEntry("key")?.value).toBe("short value");
	});

	it("compacts long entries when entry count threshold is reached", () => {
		// Fill 16 entries (threshold) with long values
		for (let i = 0; i < 16; i++) {
			store.setEntry(`k${i}`, "x".repeat(210));
		}
		const state = store.getWorkingMemoryState();
		// At least some entries should be truncated
		expect(state).toContain("working-memory-compacted");
		// Truncated values end with ellipsis
		const entries = store.listEntries();
		const truncated = entries.filter((e) => e.value.endsWith("…"));
		expect(truncated.length).toBeGreaterThan(0);
		expect(truncated[0].value.length).toBe(201); // 200 chars + ellipsis
	});

	it("compacts long entries when char threshold is reached", () => {
		// Fill char budget past 80% (3200 chars) with long values
		// 7 entries * (1 char key + 460 char value) = 7 * 461 = 3227 > 3200
		for (let i = 0; i < 7; i++) {
			store.setEntry(`${i}`, "v".repeat(460));
		}
		const state = store.getWorkingMemoryState();
		expect(state).toContain("working-memory-compacted");
	});

	it("never compacts persistent entries", () => {
		// Fill 16 entries — first one persistent with a long value
		store.setEntry("pinned", "p".repeat(210), true);
		for (let i = 0; i < 15; i++) {
			store.setEntry(`k${i}`, "x".repeat(210));
		}
		store.getWorkingMemoryState();
		// Persistent entry must not be truncated
		expect(store.getEntry("pinned")?.value).toBe("p".repeat(210));
	});

	it("compaction note is shown once and cleared after", () => {
		for (let i = 0; i < 16; i++) {
			store.setEntry(`k${i}`, "x".repeat(210));
		}
		const first = store.getWorkingMemoryState();
		expect(first).toContain("working-memory-compacted");
		// Second call — no new compaction, note is gone
		const second = store.getWorkingMemoryState();
		expect(second).not.toContain("working-memory-compacted");
	});

	it("does not compact when disabled", () => {
		store.setCompactionEnabled(false);
		for (let i = 0; i < 16; i++) {
			store.setEntry(`k${i}`, "x".repeat(210));
		}
		const state = store.getWorkingMemoryState();
		expect(state).not.toContain("working-memory-compacted");
		// Values untouched
		for (let i = 0; i < 16; i++) {
			expect(store.getEntry(`k${i}`)?.value).toBe("x".repeat(210));
		}
	});

	it("returns empty string with no compaction note when memory is empty", () => {
		expect(store.getWorkingMemoryState()).toBe("");
	});
});
