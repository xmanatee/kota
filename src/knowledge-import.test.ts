import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseImportEntries } from "./extensions/knowledge/cli.js";
import { KnowledgeStore, resetKnowledgeStore } from "./memory/knowledge-store.js";

describe("parseImportEntries", () => {
	it("parses a JSON array", () => {
		const input = JSON.stringify([
			{ title: "A", body: "Content A" },
			{ title: "B", body: "Content B", tags: ["x", "y"] },
		]);
		const entries = parseImportEntries(input);
		expect(entries).toHaveLength(2);
		expect(entries[0].title).toBe("A");
		expect(entries[1].tags).toEqual(["x", "y"]);
	});

	it("parses a JSONL file", () => {
		const lines = [
			JSON.stringify({ title: "Line 1", body: "Body 1" }),
			JSON.stringify({ title: "Line 2", body: "Body 2", tags: ["tag"] }),
		].join("\n");
		const entries = parseImportEntries(lines);
		expect(entries).toHaveLength(2);
		expect(entries[0].title).toBe("Line 1");
		expect(entries[1].body).toBe("Body 2");
	});

	it("skips blank lines in JSONL", () => {
		const lines = [
			JSON.stringify({ title: "A", body: "a" }),
			"",
			JSON.stringify({ title: "B", body: "b" }),
		].join("\n");
		const entries = parseImportEntries(lines);
		expect(entries).toHaveLength(2);
	});

	it("throws on invalid JSON array", () => {
		expect(() => parseImportEntries("[invalid json")).toThrow();
	});

	it("throws on invalid JSON array (malformed brackets)", () => {
		expect(() => parseImportEntries("[{bad json")).toThrow();
	});
});

describe("knowledge import integration", () => {
	let tmpDir: string;
	let projectDir: string;
	let store: KnowledgeStore;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "kb-import-test-"));
		projectDir = join(tmpDir, "project");
		mkdirSync(projectDir, { recursive: true });
		store = new KnowledgeStore(projectDir);
		resetKnowledgeStore();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		resetKnowledgeStore();
	});

	it("creates entries for valid rows and counts skipped ones", () => {
		const data = [
			{ title: "Valid A", body: "Body A" },
			{ title: "Valid B", body: "Body B", tags: ["foo"] },
			{ body: "Missing title" },
			{ title: "Missing body" },
		];
		const entries = parseImportEntries(JSON.stringify(data));

		let imported = 0;
		let skipped = 0;
		for (const entry of entries) {
			if (typeof entry.title !== "string" || !entry.title || typeof entry.body !== "string") {
				skipped++;
				continue;
			}
			const tags =
				Array.isArray(entry.tags) && (entry.tags as unknown[]).every((t) => typeof t === "string")
					? (entry.tags as string[])
					: [];
			store.create({ title: entry.title, content: entry.body as string, tags });
			imported++;
		}

		expect(imported).toBe(2);
		expect(skipped).toBe(2);
		expect(store.count()).toBe(2);
	});

	it("imports from a JSONL file on disk", () => {
		const file = join(tmpDir, "import.jsonl");
		const lines = [
			JSON.stringify({ title: "Doc 1", body: "Content 1" }),
			JSON.stringify({ title: "Doc 2", body: "Content 2", tags: ["ref"] }),
		].join("\n");
		writeFileSync(file, lines, "utf-8");

		const entries = parseImportEntries(lines);
		expect(entries).toHaveLength(2);

		for (const entry of entries) {
			if (typeof entry.title === "string" && entry.title && typeof entry.body === "string") {
				store.create({ title: entry.title, content: entry.body as string });
			}
		}
		expect(store.count()).toBe(2);
		const list = store.list();
		expect(list.map((e) => e.title).sort()).toEqual(["Doc 1", "Doc 2"]);
	});
});
