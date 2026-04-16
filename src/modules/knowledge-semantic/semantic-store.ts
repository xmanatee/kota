/**
 * SemanticKnowledgeStore — KnowledgeProvider variant that augments the
 * file-based base store with embedding-backed semantic search.
 *
 * - CRUD delegates to the base store, which remains the source of truth.
 * - Embeddings live in a sidecar `.embeddings.json` file per storage dir.
 * - create/update schedule embedding work on a non-blocking background queue.
 * - semanticSearch embeds the query, merges project+global indexes, scores
 *   by cosine similarity, and falls back to keyword search on any failure.
 * - reindex rebuilds the index from all current entries.
 */

import type { KnowledgeStore, ReindexResult } from "#core/memory/knowledge-store.js";
import type {
	KnowledgeEntry,
	SearchFilters,
} from "#core/memory/knowledge-store-helpers.js";
import type { KnowledgeProvider } from "#core/modules/provider-types.js";
import { cosineSimilarity } from "./cosine.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import {
	type IndexedEmbedding,
	indexPathFor,
	type SemanticIndex,
	SemanticIndexFile,
} from "./semantic-index.js";

/** Maximum chars embedded per entry — keeps API cost bounded on large entries. */
const EMBED_TEXT_LIMIT = 4000;

export type SemanticStoreOptions = {
	base: KnowledgeStore;
	provider: EmbeddingProvider;
	/**
	 * Called when background embedding fails. Defaults to console.error.
	 * Tests override this to assert error handling without polluting output.
	 */
	onBackgroundError?: (err: unknown) => void;
};

function buildIndexableText(entry: KnowledgeEntry): string {
	const tags = entry.tags.join(" ");
	const head = `${entry.title}\n${entry.type} ${tags}`;
	const body = entry.content.slice(0, EMBED_TEXT_LIMIT);
	return `${head}\n${body}`.trim();
}

export class SemanticKnowledgeStore implements KnowledgeProvider {
	private base: KnowledgeStore;
	private provider: EmbeddingProvider;
	private onBackgroundError: (err: unknown) => void;
	private pending: Promise<void> = Promise.resolve();
	private indexCache = new Map<string, SemanticIndex>();

	constructor(options: SemanticStoreOptions) {
		this.base = options.base;
		this.provider = options.provider;
		this.onBackgroundError =
			options.onBackgroundError ??
			((err) => console.error("[knowledge-semantic] background embed failed:", err));
	}

	create(opts: Parameters<KnowledgeStore["create"]>[0]): string {
		const id = this.base.create(opts);
		this.enqueueEmbed(id);
		return id;
	}

	read(id: string): KnowledgeEntry | null {
		return this.base.read(id);
	}

	update(
		id: string,
		changes: Parameters<KnowledgeStore["update"]>[1],
	): boolean {
		const ok = this.base.update(id, changes);
		if (ok) this.enqueueEmbed(id);
		return ok;
	}

	delete(id: string): boolean {
		const dir = this.base.entryDir(id);
		const ok = this.base.delete(id);
		if (ok && dir) this.removeFromIndex(dir, id);
		return ok;
	}

	search(query: string, filters?: SearchFilters): KnowledgeEntry[] {
		return this.base.search(query, filters);
	}

	list(filters?: SearchFilters): KnowledgeEntry[] {
		return this.base.list(filters);
	}

	count(type?: string): number {
		return this.base.count(type);
	}

	/** Wait for all pending background embeddings to settle. */
	async flush(): Promise<void> {
		await this.pending;
	}

	async semanticSearch(
		query: string,
		topK: number,
		filters?: SearchFilters,
	): Promise<KnowledgeEntry[]> {
		const limit = Math.max(0, topK);
		if (limit === 0) return [];
		const entries = this.base.list(filters);
		if (entries.length === 0) return [];

		try {
			await this.ensureIndexed(entries);
			const [queryVec] = await this.provider.embed([query]);
			const merged = this.mergedIndex();
			const scored: Array<{ entry: KnowledgeEntry; score: number }> = [];
			for (const entry of entries) {
				const indexed = merged.get(entry.id);
				if (!indexed) continue;
				scored.push({
					entry,
					score: cosineSimilarity(queryVec, indexed.embedding),
				});
			}
			scored.sort((a, b) => b.score - a.score);
			return scored.slice(0, limit).map((x) => x.entry);
		} catch (err) {
			this.onBackgroundError(err);
			return this.base.search(query, filters).slice(0, limit);
		}
	}

	async reindex(): Promise<ReindexResult> {
		await this.flush();
		const entries = this.base.list();
		if (entries.length === 0) return { indexed: 0, failed: 0 };

		const groups = new Map<string, KnowledgeEntry[]>();
		for (const entry of entries) {
			const dir = this.base.entryDir(entry.id);
			if (!dir) continue;
			let bucket = groups.get(dir);
			if (!bucket) {
				bucket = [];
				groups.set(dir, bucket);
			}
			bucket.push(entry);
		}

		let indexed = 0;
		let failed = 0;
		for (const [dir, group] of groups) {
			try {
				const texts = group.map(buildIndexableText);
				const vectors = await this.provider.embed(texts);
				const index: SemanticIndex = {
					version: 1,
					model: this.provider.model,
					entries: {},
				};
				for (let i = 0; i < group.length; i++) {
					index.entries[group[i].id] = {
						updated: group[i].updated,
						embedding: vectors[i],
					};
				}
				this.writeIndex(dir, index);
				indexed += group.length;
			} catch (err) {
				this.onBackgroundError(err);
				failed += group.length;
			}
		}
		return { indexed, failed };
	}

	private enqueueEmbed(id: string): void {
		this.pending = this.pending.then(() => this.embedEntry(id));
	}

	private async embedEntry(id: string): Promise<void> {
		try {
			const entry = this.base.read(id);
			if (!entry) return;
			const dir = this.base.entryDir(id);
			if (!dir) return;
			const [vector] = await this.provider.embed([buildIndexableText(entry)]);
			const index = this.readIndex(dir);
			index.entries[id] = { updated: entry.updated, embedding: vector };
			this.writeIndex(dir, index);
		} catch (err) {
			this.onBackgroundError(err);
		}
	}

	private async ensureIndexed(entries: KnowledgeEntry[]): Promise<void> {
		const merged = this.mergedIndex();
		const missing: Array<{ entry: KnowledgeEntry; dir: string }> = [];
		for (const entry of entries) {
			const cached = merged.get(entry.id);
			if (cached && cached.updated === entry.updated) continue;
			const dir = this.base.entryDir(entry.id);
			if (!dir) continue;
			missing.push({ entry, dir });
		}
		if (missing.length === 0) return;

		const vectors = await this.provider.embed(
			missing.map((m) => buildIndexableText(m.entry)),
		);
		const byDir = new Map<string, SemanticIndex>();
		for (let i = 0; i < missing.length; i++) {
			const { entry, dir } = missing[i];
			let index = byDir.get(dir);
			if (!index) {
				index = this.readIndex(dir);
				byDir.set(dir, index);
			}
			index.entries[entry.id] = {
				updated: entry.updated,
				embedding: vectors[i],
			};
		}
		for (const [dir, index] of byDir) {
			this.writeIndex(dir, index);
		}
	}

	private mergedIndex(): Map<string, IndexedEmbedding> {
		const out = new Map<string, IndexedEmbedding>();
		for (const dir of this.listStorageDirs()) {
			const index = this.readIndex(dir);
			for (const [id, value] of Object.entries(index.entries)) {
				out.set(id, value);
			}
		}
		return out;
	}

	private listStorageDirs(): string[] {
		const dirs: string[] = [];
		const project = this.base.getProjectDir();
		if (project) dirs.push(project);
		dirs.push(this.base.getGlobalDir());
		return dirs;
	}

	private readIndex(dir: string): SemanticIndex {
		const cached = this.indexCache.get(dir);
		if (cached) return cached;
		const file = new SemanticIndexFile(indexPathFor(dir));
		const index = file.load(this.provider.model);
		this.indexCache.set(dir, index);
		return index;
	}

	private writeIndex(dir: string, index: SemanticIndex): void {
		this.indexCache.set(dir, index);
		new SemanticIndexFile(indexPathFor(dir)).save(index);
	}

	private removeFromIndex(dir: string, id: string): void {
		const index = this.readIndex(dir);
		if (index.entries[id]) {
			delete index.entries[id];
			this.writeIndex(dir, index);
		}
	}
}
