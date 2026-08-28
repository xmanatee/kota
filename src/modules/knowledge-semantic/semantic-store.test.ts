import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import {
	indexPathFor,
	SemanticIndexFile,
} from "#modules/semantic-index/semantic-index.js";
import { FakeEmbeddingProvider } from "#modules/semantic-index/test-support.js";
import { SemanticKnowledgeStore } from "./semantic-store.js";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`kota-sem-store-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("SemanticKnowledgeStore", () => {
	let scopeRoot: string;
	let globalDir: string;
	let base: KnowledgeStore;
	let provider: FakeEmbeddingProvider;
	let store: SemanticKnowledgeStore;
	let errors: unknown[];

	beforeEach(() => {
		scopeRoot = makeTmpDir();
		globalDir = makeTmpDir();
		base = new KnowledgeStore(scopeRoot, globalDir);
		provider = new FakeEmbeddingProvider();
		errors = [];
		store = new SemanticKnowledgeStore({
			base,
			provider,
			onBackgroundError: (e) => errors.push(e),
		});
	});

	afterEach(() => {
		rmSync(scopeRoot, { recursive: true, force: true });
		rmSync(globalDir, { recursive: true, force: true });
	});

	it("declares all four semantic capabilities", () => {
		expect(store.capabilities).toEqual({
			mutation: true,
			deletion: true,
			reindex: true,
			search: true,
		});
	});

	it("indexes entries on create and persists to sidecar", async () => {
		const id = store.create({
			title: "Budget monitoring",
			content: "track spend and cost anomaly alerts",
			tags: ["budget"],
		});
		await store.flush();

		expect(errors).toEqual([]);
		expect(provider.calls).toBeGreaterThanOrEqual(1);
		const sidecar = indexPathFor(join(scopeRoot, ".kota", "data"));
		expect(existsSync(sidecar)).toBe(true);

		const results = await store.semanticSearch("workflow cost tracking", 5);
		expect(results.map((r) => r.id)).toContain(id);
	});

	it("re-embeds when an entry is updated (timestamp fingerprint invalidation)", async () => {
		const id = store.create({
			title: "Misc note",
			content: "bread baking recipe",
			tags: [],
		});
		await store.flush();

		const sidecarPath = indexPathFor(join(scopeRoot, ".kota", "data"));
		const before = new SemanticIndexFile(sidecarPath).load(provider.model);
		const embBefore = [...before.entries[id].embedding];

		store.update(id, { content: "monitor spend and cost anomaly" });
		await store.flush();

		const after = new SemanticIndexFile(sidecarPath).load(provider.model);
		expect(after.entries[id].embedding).not.toEqual(embBefore);
	});

	it("removes deleted entries from the sidecar index", async () => {
		const id = store.create({
			title: "Temp entry",
			content: "monitor spend",
			tags: [],
		});
		await store.flush();

		const before = await store.semanticSearch("cost", 5);
		expect(before.map((r) => r.id)).toContain(id);

		store.delete(id);
		const after = await store.semanticSearch("cost", 5);
		expect(after.map((r) => r.id)).not.toContain(id);
	});

	it("reindexes knowledge entries using manager", async () => {
		store.create({
			title: "Entry A",
			content: "monitor spend",
			tags: ["budget"],
		});
		store.create({
			title: "Entry B",
			content: "baking bread",
			tags: ["recipe"],
		});
		await store.flush();

		const result = await store.reindex();
		expect(result.indexed).toBe(2);
		expect(result.failed).toBe(0);
	});

	it("respects search filters during semantic search", async () => {
		const scopeId = store.create({
			title: "Scope Note",
			content: "monitor spend and cost",
			tags: ["budget"],
			scope: "scope",
		});
		store.create({
			title: "Global Note",
			content: "monitor spend and cost",
			tags: ["other"],
			scope: "global",
		});
		await store.flush();

		const results = await store.semanticSearch("cost tracking", 5, {
			tag: "budget",
			scope: "scope",
		});
		expect(results.map((r) => r.id)).toEqual([scopeId]);
	});

	it("delegates base operations (read, search, list, count) to base KnowledgeStore", () => {
		const id = store.create({
			title: "Plain note",
			content: "some text about budgeting",
			type: "doc",
			tags: ["finance"],
		});

		expect(store.read(id)?.title).toBe("Plain note");
		expect(store.search("budgeting").map((r) => r.id)).toContain(id);
		expect(store.list({ type: "doc" }).map((r) => r.id)).toContain(id);
		expect(store.count("doc")).toBe(1);
	});
});
