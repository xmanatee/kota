import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	KnowledgeStore,
	parseFrontMatter,
	serializeFrontMatter,
	toSlug,
} from "./knowledge-store.js";

// --- Front matter parsing ---

describe("parseFrontMatter", () => {
	it("parses simple key-value pairs", () => {
		const raw = "---\ntitle: Hello World\ntype: note\n---\nBody here";
		const { attrs, body } = parseFrontMatter(raw);
		expect(attrs.title).toBe("Hello World");
		expect(attrs.type).toBe("note");
		expect(body).toBe("Body here");
	});

	it("parses array values", () => {
		const raw = "---\ntags: [foo, bar, baz]\n---\n";
		const { attrs } = parseFrontMatter(raw);
		expect(attrs.tags).toEqual(["foo", "bar", "baz"]);
	});

	it("handles empty arrays", () => {
		const raw = "---\ntags: []\n---\ncontent";
		const { attrs } = parseFrontMatter(raw);
		expect(attrs.tags).toEqual([]);
	});

	it("returns raw body when no front matter", () => {
		const raw = "No front matter here";
		const { attrs, body } = parseFrontMatter(raw);
		expect(attrs).toEqual({});
		expect(body).toBe("No front matter here");
	});

	it("skips comment lines", () => {
		const raw = "---\n# comment\ntitle: Test\n---\nbody";
		const { attrs } = parseFrontMatter(raw);
		expect(attrs.title).toBe("Test");
		expect(attrs["# comment"]).toBeUndefined();
	});

	it("handles multiline body", () => {
		const raw = "---\nid: abc\n---\nLine 1\nLine 2\nLine 3";
		const { body } = parseFrontMatter(raw);
		expect(body).toBe("Line 1\nLine 2\nLine 3");
	});
});

describe("serializeFrontMatter", () => {
	it("serializes string and array values", () => {
		const result = serializeFrontMatter(
			{ title: "Test", tags: ["a", "b"] },
			"Body",
		);
		expect(result).toContain("title: Test");
		expect(result).toContain("tags: [a, b]");
		expect(result).toContain("Body");
	});

	it("round-trips through parse", () => {
		const attrs = { id: "x1", title: "Round Trip", tags: ["tag1"] };
		const body = "Some content\nwith lines";
		const serialized = serializeFrontMatter(attrs, body);
		const parsed = parseFrontMatter(serialized);
		expect(parsed.attrs.id).toBe("x1");
		expect(parsed.attrs.title).toBe("Round Trip");
		expect(parsed.attrs.tags).toEqual(["tag1"]);
		expect(parsed.body).toBe(body);
	});
});

describe("toSlug", () => {
	it("converts to lowercase kebab-case", () => {
		expect(toSlug("Hello World")).toBe("hello-world");
	});

	it("strips special characters", () => {
		expect(toSlug("API Design (v2)")).toBe("api-design-v2");
	});

	it("truncates long titles", () => {
		const long = "a".repeat(100);
		expect(toSlug(long).length).toBeLessThanOrEqual(60);
	});

	it("trims leading/trailing hyphens", () => {
		expect(toSlug("--hello--")).toBe("hello");
	});
});

// --- KnowledgeStore ---

describe("KnowledgeStore", () => {
	let tmpDir: string;
	let projectDir: string;
	let globalDir: string;
	let store: KnowledgeStore;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "kb-test-"));
		projectDir = join(tmpDir, "project");
		globalDir = join(tmpDir, "global");
		mkdirSync(projectDir, { recursive: true });
		store = new KnowledgeStore(projectDir, globalDir);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates and reads an entry", () => {
		const id = store.create({
			title: "Test Entry",
			content: "Hello world",
			type: "note",
			tags: ["test"],
		});

		const entry = store.read(id);
		expect(entry).not.toBeNull();
		expect(entry!.title).toBe("Test Entry");
		expect(entry!.content).toBe("Hello world");
		expect(entry!.type).toBe("note");
		expect(entry!.tags).toEqual(["test"]);
		expect(entry!.status).toBe("active");
		expect(entry!.id).toBe(id);
	});

	it("creates in global scope", () => {
		const id = store.create({
			title: "Global Entry",
			content: "Global content",
			scope: "global",
		});
		const entry = store.read(id);
		expect(entry).not.toBeNull();
		expect(entry!.title).toBe("Global Entry");
	});

	it("updates an entry", () => {
		const id = store.create({
			title: "Original",
			content: "Original content",
			tags: ["old"],
		});

		const ok = store.update(id, {
			title: "Updated",
			content: "New content",
			tags: ["new"],
			status: "archived",
		});
		expect(ok).toBe(true);

		const entry = store.read(id);
		expect(entry!.title).toBe("Updated");
		expect(entry!.content).toBe("New content");
		expect(entry!.tags).toEqual(["new"]);
		expect(entry!.status).toBe("archived");
	});

	it("update returns false for unknown ID", () => {
		expect(store.update("nonexistent", { title: "X" })).toBe(false);
	});

	it("deletes an entry", () => {
		const id = store.create({ title: "To Delete", content: "bye" });
		expect(store.delete(id)).toBe(true);
		expect(store.read(id)).toBeNull();
	});

	it("delete returns false for unknown ID", () => {
		expect(store.delete("nonexistent")).toBe(false);
	});

	it("lists all created entries", () => {
		store.create({ title: "First", content: "1" });
		store.create({ title: "Second", content: "2" });
		store.create({ title: "Third", content: "3" });

		const entries = store.list();
		expect(entries.length).toBe(3);
		const titles = entries.map((e) => e.title).sort();
		expect(titles).toEqual(["First", "Second", "Third"]);
	});

	it("lists with type filter", () => {
		store.create({ title: "Note A", content: "", type: "note" });
		store.create({ title: "Plan B", content: "", type: "plan" });
		store.create({ title: "Note C", content: "", type: "note" });

		const notes = store.list({ type: "note" });
		expect(notes.length).toBe(2);
		expect(notes.every((e) => e.type === "note")).toBe(true);
	});

	it("lists with tag filter", () => {
		store.create({ title: "A", content: "", tags: ["api", "design"] });
		store.create({ title: "B", content: "", tags: ["api"] });
		store.create({ title: "C", content: "", tags: ["other"] });

		const results = store.list({ tag: "api" });
		expect(results.length).toBe(2);
	});

	it("lists with status filter", () => {
		store.create({ title: "Active", content: "", status: "active" });
		store.create({ title: "Archived", content: "", status: "archived" });

		const active = store.list({ status: "active" });
		expect(active.length).toBe(1);
		expect(active[0].title).toBe("Active");
	});

	it("searches by keyword", () => {
		store.create({
			title: "API Design",
			content: "REST endpoints for the user service",
		});
		store.create({
			title: "Database Schema",
			content: "PostgreSQL tables for the order system",
		});
		store.create({
			title: "API Auth",
			content: "OAuth2 flow for API authentication",
		});

		const results = store.search("API");
		expect(results.length).toBe(2);
		expect(results[0].title).toContain("API");
	});

	it("searches with type filter", () => {
		store.create({
			title: "Research A",
			content: "findings",
			type: "research",
		});
		store.create({
			title: "Research B",
			content: "findings",
			type: "note",
		});

		const results = store.search("findings", { type: "research" });
		expect(results.length).toBe(1);
		expect(results[0].type).toBe("research");
	});

	it("counts entries", () => {
		store.create({ title: "A", content: "", type: "note" });
		store.create({ title: "B", content: "", type: "plan" });
		store.create({ title: "C", content: "", type: "note" });

		expect(store.count()).toBe(3);
		expect(store.count("note")).toBe(2);
		expect(store.count("plan")).toBe(1);
	});

	it("stores custom metadata", () => {
		const id = store.create({
			title: "With Meta",
			content: "body",
			meta: { priority: "high", assignee: "alice" },
		});

		const entry = store.read(id);
		expect(entry!.meta.priority).toBe("high");
		expect(entry!.meta.assignee).toBe("alice");
	});

	it("updates custom metadata", () => {
		const id = store.create({
			title: "Meta Update",
			content: "body",
			meta: { priority: "low" },
		});

		store.update(id, { meta: { priority: "high", source: "web" } });
		const entry = store.read(id);
		expect(entry!.meta.priority).toBe("high");
		expect(entry!.meta.source).toBe("web");
	});

	it("handles entries across project and global scopes", () => {
		store.create({
			title: "Project Entry",
			content: "local",
			scope: "project",
		});
		store.create({
			title: "Global Entry",
			content: "global",
			scope: "global",
		});

		// Default list gets both
		expect(store.list().length).toBe(2);

		// Scoped list
		const projectOnly = store.list({ scope: "project" });
		expect(projectOnly.length).toBe(1);
		expect(projectOnly[0].title).toBe("Project Entry");

		const globalOnly = store.list({ scope: "global" });
		expect(globalOnly.length).toBe(1);
		expect(globalOnly[0].title).toBe("Global Entry");
	});

	it("reads files created externally (interop)", () => {
		const dir = join(projectDir, ".kota", "data");
		mkdirSync(dir, { recursive: true });
		const content = [
			"---",
			"id: ext123",
			"title: External Entry",
			"type: reference",
			"tags: [manual]",
			"status: active",
			"created: 2024-01-01T00:00:00Z",
			"updated: 2024-01-01T00:00:00Z",
			"---",
			"Manually created markdown file.",
		].join("\n");
		writeFileSync(join(dir, "external-ext123.md"), content, "utf-8");

		const entry = store.read("ext123");
		expect(entry).not.toBeNull();
		expect(entry!.title).toBe("External Entry");
		expect(entry!.type).toBe("reference");
		expect(entry!.content).toBe("Manually created markdown file.");
	});
});
