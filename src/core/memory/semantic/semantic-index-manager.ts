/**
 * Generic embedding-index engine shared by semantic store wrappers.
 *
 * Owns the background embed queue, the sidecar index cache, cosine-based
 * ranking, and bulk reindex. Concrete wrappers (knowledge, memory) supply a
 * small adapter describing how to extract id/fingerprint/text from their
 * entry shape and where sidecar files live.
 */

import type { ReindexResult } from "#core/modules/provider-types.js";
import { cosineSimilarity } from "./cosine.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import {
	INDEX_VERSION,
	type IndexedEmbedding,
	indexPathFor,
	type SemanticIndex,
	SemanticIndexFile,
} from "./semantic-index.js";

/** Maximum chars embedded per entry — keeps API cost bounded on large entries. */
export const EMBED_TEXT_LIMIT = 4000;

export type { ReindexResult };

/**
 * Adapter the manager calls to reach into the concrete entry type (memory,
 * knowledge, …). Implementations are thin — the heavy lifting lives in the
 * manager.
 */
export interface SemanticStoreAdapter<TEntry> {
	id(entry: TEntry): string;
	/** Opaque string that changes whenever the entry's embedded text changes. */
	fingerprint(entry: TEntry): string;
	/** Text payload to embed (truncated to EMBED_TEXT_LIMIT by the manager). */
	indexableText(entry: TEntry): string;
	readEntry(id: string): TEntry | null;
	/** Directory whose sidecar index holds this entry's embedding. */
	resolveStorageDir(id: string): string | null;
	/** All storage directories — the manager merges indexes across them. */
	listStorageDirs(): string[];
}

type EmbedTarget<TEntry> = {
	entry: TEntry;
	dir: string;
};

export class SemanticIndexManager<TEntry> {
	private adapter: SemanticStoreAdapter<TEntry>;
	private provider: EmbeddingProvider;
	private onError: (err: unknown) => void;
	private pending: Promise<void> = Promise.resolve();
	private indexCache = new Map<string, SemanticIndex>();

	constructor(options: {
		adapter: SemanticStoreAdapter<TEntry>;
		provider: EmbeddingProvider;
		onError: (err: unknown) => void;
	}) {
		this.adapter = options.adapter;
		this.provider = options.provider;
		this.onError = options.onError;
	}

	/** Schedule a background embed for the given entry id. */
	enqueueEmbed(id: string): void {
		this.pending = this.pending.then(() => this.embedOne(id));
	}

	/** Remove an entry's embedding from the sidecar in the given directory. */
	removeFromIndex(dir: string, id: string): void {
		const index = this.readIndex(dir);
		if (index.entries[id]) {
			delete index.entries[id];
			this.writeIndex(dir, index);
		}
	}

	/** Wait for all scheduled background embeds to finish. */
	async flush(): Promise<void> {
		await this.pending;
	}

	/**
	 * Rank `entries` by cosine similarity to `query`. Missing/stale entries
	 * are embedded lazily before scoring. Returns the top `topK` entries
	 * sorted by similarity. Embedding/query failures are surfaced to the caller.
	 */
	async rankBySimilarity(
		query: string,
		entries: TEntry[],
		topK: number,
	): Promise<TEntry[]> {
		const limit = Math.max(0, topK);
		if (limit === 0) return [];
		if (entries.length === 0) return [];

		try {
			await this.ensureIndexed(entries);
			const [queryVec] = await this.provider.embed([query]);
			const merged = this.mergedIndex();
			const scored: Array<{ entry: TEntry; score: number }> = [];
			for (const entry of entries) {
				const indexed = merged.get(this.adapter.id(entry));
				if (!indexed) continue;
				scored.push({
					entry,
					score: cosineSimilarity(queryVec, indexed.embedding),
				});
			}
			scored.sort((a, b) => b.score - a.score);
			return scored.slice(0, limit).map((x) => x.entry);
		} catch (err) {
			this.onError(err);
			throw err;
		}
	}

	/** Rebuild the full embedding index from the given entries. */
	async rebuildIndex(entries: TEntry[]): Promise<ReindexResult> {
		await this.flush();
		if (entries.length === 0) return { indexed: 0, failed: 0 };

		const groups = new Map<string, TEntry[]>();
		for (const entry of entries) {
			const dir = this.adapter.resolveStorageDir(this.adapter.id(entry));
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
				const texts = group.map((e) => this.buildText(e));
				const vectors = await this.provider.embed(texts);
				const index: SemanticIndex = {
					version: INDEX_VERSION,
					model: this.provider.model,
					entries: {},
				};
				for (let i = 0; i < group.length; i++) {
					index.entries[this.adapter.id(group[i])] = {
						fingerprint: this.adapter.fingerprint(group[i]),
						embedding: vectors[i],
					};
				}
				this.writeIndex(dir, index);
				indexed += group.length;
			} catch (err) {
				this.onError(err);
				failed += group.length;
			}
		}
		return { indexed, failed };
	}

	private async embedOne(id: string): Promise<void> {
		try {
			const entry = this.adapter.readEntry(id);
			if (!entry) return;
			const dir = this.adapter.resolveStorageDir(id);
			if (!dir) return;
			const [vector] = await this.provider.embed([this.buildText(entry)]);
			const index = this.readIndex(dir);
			index.entries[id] = {
				fingerprint: this.adapter.fingerprint(entry),
				embedding: vector,
			};
			this.writeIndex(dir, index);
		} catch (err) {
			this.onError(err);
		}
	}

	private async ensureIndexed(entries: TEntry[]): Promise<void> {
		const merged = this.mergedIndex();
		const missing: EmbedTarget<TEntry>[] = [];
		for (const entry of entries) {
			const id = this.adapter.id(entry);
			const cached = merged.get(id);
			if (cached && cached.fingerprint === this.adapter.fingerprint(entry)) continue;
			const dir = this.adapter.resolveStorageDir(id);
			if (!dir) continue;
			missing.push({ entry, dir });
		}
		if (missing.length === 0) return;

		const vectors = await this.provider.embed(
			missing.map((m) => this.buildText(m.entry)),
		);
		const byDir = new Map<string, SemanticIndex>();
		for (let i = 0; i < missing.length; i++) {
			const { entry, dir } = missing[i];
			let index = byDir.get(dir);
			if (!index) {
				index = this.readIndex(dir);
				byDir.set(dir, index);
			}
			index.entries[this.adapter.id(entry)] = {
				fingerprint: this.adapter.fingerprint(entry),
				embedding: vectors[i],
			};
		}
		for (const [dir, index] of byDir) {
			this.writeIndex(dir, index);
		}
	}

	private mergedIndex(): Map<string, IndexedEmbedding> {
		const out = new Map<string, IndexedEmbedding>();
		for (const dir of this.adapter.listStorageDirs()) {
			const index = this.readIndex(dir);
			for (const [id, value] of Object.entries(index.entries)) {
				out.set(id, value);
			}
		}
		return out;
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

	private buildText(entry: TEntry): string {
		return this.adapter.indexableText(entry).slice(0, EMBED_TEXT_LIMIT);
	}
}
