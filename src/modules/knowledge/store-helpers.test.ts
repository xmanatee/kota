import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyFilters,
	findFileByIdInDir,
	type KnowledgeEntry,
	parseKnowledgeFile,
} from "./store-helpers.js";

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
	return {
		id: "test-id",
		title: "Test",
		type: "note",
		tags: [],
		status: "active",
		created: "2024-01-01T00:00:00Z",
		updated: "2024-01-01T00:00:00Z",
		content: "body",
		meta: {},
		...overrides,
	};
}

function writeMd(dir: string, filename: string, lines: string[]): void {
	writeFileSync(join(dir, filename), lines.join("\n"), "utf-8");
}

// --- applyFilters ---

describe("applyFilters", () => {
	it("returns all entries when filters is undefined", () => {
		const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
		expect(applyFilters(entries, undefined)).toEqual(entries);
	});

	it("returns all entries when filters object is empty", () => {
		const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
		expect(applyFilters(entries, {})).toEqual(entries);
	});

	it("filters by type (exact match)", () => {
		const entries = [
			makeEntry({ id: "a", type: "note" }),
			makeEntry({ id: "b", type: "plan" }),
		];
		expect(applyFilters(entries, { type: "note" })).toHaveLength(1);
		expect(applyFilters(entries, { type: "note" })[0].id).toBe("a");
	});

	it("filters by type case-insensitively", () => {
		const entries = [makeEntry({ id: "a", type: "Note" })];
		expect(applyFilters(entries, { type: "NOTE" })).toHaveLength(1);
		expect(applyFilters(entries, { type: "note" })).toHaveLength(1);
	});

	it("filters by tag (exact match)", () => {
		const entries = [
			makeEntry({ id: "a", tags: ["api", "design"] }),
			makeEntry({ id: "b", tags: ["testing"] }),
		];
		expect(applyFilters(entries, { tag: "api" })).toHaveLength(1);
		expect(applyFilters(entries, { tag: "api" })[0].id).toBe("a");
	});

	it("filters by tag case-insensitively", () => {
		const entries = [makeEntry({ id: "a", tags: ["API"] })];
		expect(applyFilters(entries, { tag: "api" })).toHaveLength(1);
	});

	it("filters by status", () => {
		const entries = [
			makeEntry({ id: "a", status: "active" }),
			makeEntry({ id: "b", status: "archived" }),
		];
		expect(applyFilters(entries, { status: "active" })).toHaveLength(1);
		expect(applyFilters(entries, { status: "active" })[0].id).toBe("a");
	});

	it("filters by status case-insensitively", () => {
		const entries = [makeEntry({ id: "a", status: "Active" })];
		expect(applyFilters(entries, { status: "ACTIVE" })).toHaveLength(1);
	});

	it("filters by since — keeps entries created on or after the date", () => {
		const entries = [
			makeEntry({ id: "old", created: "2023-01-01T00:00:00Z" }),
			makeEntry({ id: "new", created: "2025-06-01T00:00:00Z" }),
		];
		const result = applyFilters(entries, { since: "2024-01-01" });
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("new");
	});

	it("ignores an invalid since date (passes all entries through)", () => {
		const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
		expect(applyFilters(entries, { since: "not-a-date" })).toHaveLength(2);
	});

	it("applies multiple filters combined (AND semantics)", () => {
		const entries = [
			makeEntry({ id: "a", type: "note", tags: ["api"], status: "active" }),
			makeEntry({ id: "b", type: "note", tags: ["design"], status: "active" }),
			makeEntry({ id: "c", type: "plan", tags: ["api"], status: "active" }),
		];
		const result = applyFilters(entries, { type: "note", tag: "api" });
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("a");
	});
});

// --- parseKnowledgeFile ---

describe("parseKnowledgeFile", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "ksh-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null for a missing file", () => {
		expect(parseKnowledgeFile(tmpDir, "nonexistent.md")).toBeNull();
	});

	it("returns null when id field is absent", () => {
		writeMd(tmpDir, "no-id.md", [
			"---",
			"title: No ID",
			"type: note",
			"---",
			"body",
		]);
		expect(parseKnowledgeFile(tmpDir, "no-id.md")).toBeNull();
	});

	it("returns null when id field is empty", () => {
		writeMd(tmpDir, "empty-id.md", [
			"---",
			"id: ",
			"title: Empty ID",
			"---",
			"body",
		]);
		expect(parseKnowledgeFile(tmpDir, "empty-id.md")).toBeNull();
	});

	it("parses a minimal valid entry", () => {
		writeMd(tmpDir, "minimal.md", [
			"---",
			"id: abc123",
			"title: Minimal",
			"type: note",
			"tags: []",
			"status: active",
			"created: 2024-01-01T00:00:00Z",
			"updated: 2024-02-01T00:00:00Z",
			"---",
			"Content here.",
		]);
		const entry = parseKnowledgeFile(tmpDir, "minimal.md");
		expect(entry).not.toBeNull();
		expect(entry!.id).toBe("abc123");
		expect(entry!.title).toBe("Minimal");
		expect(entry!.type).toBe("note");
		expect(entry!.status).toBe("active");
		expect(entry!.created).toBe("2024-01-01T00:00:00Z");
		expect(entry!.updated).toBe("2024-02-01T00:00:00Z");
		expect(entry!.content).toBe("Content here.");
	});

	it("captures unknown keys in meta", () => {
		writeMd(tmpDir, "meta.md", [
			"---",
			"id: meta-id",
			"title: Meta Entry",
			"priority: high",
			"assignee: alice",
			"---",
			"body",
		]);
		const entry = parseKnowledgeFile(tmpDir, "meta.md");
		expect(entry).not.toBeNull();
		expect(entry!.meta.priority).toBe("high");
		expect(entry!.meta.assignee).toBe("alice");
		expect(entry!.meta.id).toBeUndefined();
		expect(entry!.meta.title).toBeUndefined();
	});

	it("parses array tags", () => {
		writeMd(tmpDir, "tags.md", [
			"---",
			"id: tag-id",
			"title: Tagged",
			"tags: [foo, bar, baz]",
			"---",
			"",
		]);
		const entry = parseKnowledgeFile(tmpDir, "tags.md");
		expect(entry).not.toBeNull();
		expect(entry!.tags).toEqual(["foo", "bar", "baz"]);
	});

	it("defaults missing optional fields", () => {
		writeMd(tmpDir, "defaults.md", ["---", "id: def-id", "---", "body"]);
		const entry = parseKnowledgeFile(tmpDir, "defaults.md");
		expect(entry).not.toBeNull();
		expect(entry!.title).toBe("");
		expect(entry!.type).toBe("note");
		expect(entry!.tags).toEqual([]);
		expect(entry!.status).toBe("active");
	});
});

// --- findFileByIdInDir ---

describe("findFileByIdInDir", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "ksh-find-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null when directory is empty", () => {
		expect(findFileByIdInDir(tmpDir, "abc123")).toBeNull();
	});

	it("returns null when id is not found", () => {
		writeMd(tmpDir, "entry-xyz789.md", [
			"---",
			"id: xyz789",
			"---",
			"",
		]);
		expect(findFileByIdInDir(tmpDir, "notexist")).toBeNull();
	});

	it("finds a file via suffix match (fast path)", () => {
		writeMd(tmpDir, "entry-abc123.md", [
			"---",
			"id: abc123",
			"---",
			"",
		]);
		expect(findFileByIdInDir(tmpDir, "abc123")).toBe("entry-abc123.md");
	});

	it("finds a file via id field when suffix does not match (slow path)", () => {
		writeMd(tmpDir, "custom-name.md", [
			"---",
			"id: slow-path-id",
			"---",
			"body",
		]);
		expect(findFileByIdInDir(tmpDir, "slow-path-id")).toBe("custom-name.md");
	});

	it("does not confuse a suffix match with a partial id match", () => {
		writeMd(tmpDir, "entry-abc.md", ["---", "id: abc", "---", ""]);
		writeMd(tmpDir, "entry-xabc.md", ["---", "id: xabc", "---", ""]);
		expect(findFileByIdInDir(tmpDir, "abc")).toBe("entry-abc.md");
		expect(findFileByIdInDir(tmpDir, "xabc")).toBe("entry-xabc.md");
	});

	it("non-existent directory returns null", () => {
		expect(findFileByIdInDir(join(tmpDir, "nonexistent"), "abc")).toBeNull();
	});
});
