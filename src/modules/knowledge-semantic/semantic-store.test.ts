import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeStore } from "#core/memory/knowledge-store.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { indexPathFor, SemanticIndexFile } from "./semantic-index.js";
import { SemanticKnowledgeStore } from "./semantic-store.js";

const CONCEPTS: Record<string, number> = {
	workflow: 0,
	pipeline: 0,
	cost: 1,
	budget: 1,
	spend: 1,
	spending: 1,
	expense: 1,
	tracking: 2,
	monitoring: 2,
	metric: 2,
	metrics: 2,
	anomaly: 3,
	alert: 3,
	bread: 4,
	baking: 4,
	recipe: 4,
	auth: 5,
	login: 5,
	session: 5,
};

const DIMS = 8;

function fakeEmbed(text: string): number[] {
	const vec = new Array(DIMS).fill(0);
	for (const word of text.toLowerCase().split(/[^a-z]+/)) {
		if (!word) continue;
		const dim = CONCEPTS[word];
		if (dim !== undefined) vec[dim] += 1;
	}
	return vec;
}

class FakeEmbeddingProvider implements EmbeddingProvider {
	readonly name = "fake";
	readonly model: string;
	public calls = 0;
	public textsSeen: string[][] = [];
	public failNext = false;

	constructor(model = "fake-model-v1") {
		this.model = model;
	}

	async embed(texts: string[]): Promise<number[][]> {
		this.calls += 1;
		this.textsSeen.push([...texts]);
		if (this.failNext) {
			this.failNext = false;
			throw new Error("fake provider failure");
		}
		return texts.map(fakeEmbed);
	}
}

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`kota-sem-store-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("SemanticKnowledgeStore", () => {
	let projectDir: string;
	let globalDir: string;
	let base: KnowledgeStore;
	let provider: FakeEmbeddingProvider;
	let store: SemanticKnowledgeStore;
	let errors: unknown[];

	beforeEach(() => {
		projectDir = makeTmpDir();
		globalDir = makeTmpDir();
		base = new KnowledgeStore(projectDir, globalDir);
		provider = new FakeEmbeddingProvider();
		errors = [];
		store = new SemanticKnowledgeStore({
			base,
			provider,
			onBackgroundError: (e) => errors.push(e),
		});
	});

	afterEach(() => {
		rmSync(projectDir, { recursive: true, force: true });
		rmSync(globalDir, { recursive: true, force: true });
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
		const sidecar = indexPathFor(join(projectDir, ".kota", "data"));
		expect(existsSync(sidecar)).toBe(true);

		const results = await store.semanticSearch("workflow cost tracking", 5);
		expect(results.map((r) => r.id)).toContain(id);
	});

	it("ranks semantically similar entries above unrelated ones", async () => {
		const costEntry = store.create({
			title: "Budget alert",
			content: "monitor spend and cost anomaly",
			tags: ["budget"],
		});
		const breadEntry = store.create({
			title: "Sourdough recipe",
			content: "baking bread at home",
			tags: ["recipe"],
		});
		const authEntry = store.create({
			title: "Login session handling",
			content: "auth session cookies",
			tags: ["auth"],
		});
		await store.flush();

		const results = await store.semanticSearch("workflow cost tracking", 3);
		expect(results[0].id).toBe(costEntry);
		const ids = results.map((r) => r.id);
		expect(ids.indexOf(costEntry)).toBeLessThan(ids.indexOf(breadEntry));
		expect(ids.indexOf(costEntry)).toBeLessThan(ids.indexOf(authEntry));
	});

	it("re-embeds when an entry is updated (incremental)", async () => {
		const id = store.create({
			title: "Misc note",
			content: "bread baking recipe",
			tags: [],
		});
		await store.flush();

		const sidecarPath = indexPathFor(join(projectDir, ".kota", "data"));
		const before = new SemanticIndexFile(sidecarPath).load(provider.model);
		const embBefore = [...before.entries[id].embedding];

		store.update(id, { content: "monitor spend and cost anomaly" });
		await store.flush();

		const after = new SemanticIndexFile(sidecarPath).load(provider.model);
		const embAfter = after.entries[id].embedding;
		expect(embAfter).not.toEqual(embBefore);
	});

	it("falls back to keyword search when the provider throws at query time", async () => {
		store.create({
			title: "Budget doc",
			content: "monitor spend and cost",
			tags: ["budget"],
		});
		await store.flush();

		provider.failNext = true;
		const results = await store.semanticSearch("budget", 5);
		expect(results.length).toBeGreaterThan(0);
		expect(errors.length).toBeGreaterThanOrEqual(1);
	});

	it("keyword search on the base store still works regardless of semantic config", () => {
		const id = store.create({
			title: "Plain note",
			content: "some text about budgeting",
			tags: [],
		});
		const results = store.search("budgeting");
		expect(results.map((r) => r.id)).toContain(id);
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

	it("reindex rebuilds the embedding index and returns counts", async () => {
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

		const before = provider.calls;
		const result = await store.reindex();
		expect(result.indexed).toBe(2);
		expect(result.failed).toBe(0);
		expect(provider.calls).toBeGreaterThan(before);
	});

	it("reindex reports failures when the provider throws", async () => {
		store.create({
			title: "Entry",
			content: "spend",
			tags: [],
		});
		await store.flush();

		provider.failNext = true;
		const result = await store.reindex();
		expect(result.failed).toBeGreaterThan(0);
		expect(errors.length).toBeGreaterThanOrEqual(1);
	});

	it("semanticSearch returns [] when topK is 0 without embedding", async () => {
		store.create({ title: "x", content: "spend", tags: [] });
		await store.flush();
		const embedCallsBefore = provider.calls;
		const results = await store.semanticSearch("cost", 0);
		expect(results).toEqual([]);
		// no additional query embedding calls
		expect(provider.calls).toBe(embedCallsBefore);
	});

	it("uses cached index without re-embedding entries on repeat query", async () => {
		store.create({
			title: "Entry",
			content: "monitor spend and cost anomaly",
			tags: [],
		});
		await store.flush();
		const callsAfterIndex = provider.calls;

		await store.semanticSearch("workflow cost", 5);
		await store.semanticSearch("workflow cost", 5);
		// Two query-embedding calls added, but no entry re-embedding.
		expect(provider.calls).toBe(callsAfterIndex + 2);
	});

	it("passes a non-Error onBackgroundError for provider failures without crashing", async () => {
		const bgSpy = vi.fn();
		const store2 = new SemanticKnowledgeStore({
			base,
			provider,
			onBackgroundError: bgSpy,
		});
		provider.failNext = true;
		store2.create({ title: "x", content: "spend", tags: [] });
		await store2.flush();
		expect(bgSpy).toHaveBeenCalled();
	});
});
