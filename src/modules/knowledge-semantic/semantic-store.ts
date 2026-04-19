/**
 * SemanticKnowledgeStore — KnowledgeProvider variant backed by the shared
 * embedding-index engine. CRUD delegates to the base store; writes enqueue
 * background embed work; queries lazily fill the index, cosine-rank the
 * results, and surface embedding errors to the caller.
 *
 * Staleness is detected via each entry's `updated` ISO timestamp, which the
 * base store already bumps on every write.
 */

import type { KnowledgeStore } from "#core/memory/knowledge-store.js";
import type {
	KnowledgeEntry,
	SearchFilters,
} from "#core/memory/knowledge-store-helpers.js";
import type { KnowledgeProvider } from "#core/modules/provider-types.js";
import type { EmbeddingProvider } from "#modules/semantic-index/embedding-provider.js";
import {
	type ReindexResult,
	SemanticIndexManager,
	type SemanticStoreAdapter,
} from "#modules/semantic-index/semantic-index-manager.js";

export type SemanticKnowledgeStoreOptions = {
	base: KnowledgeStore;
	provider: EmbeddingProvider;
	/**
	 * Called when background embedding fails. Defaults to console.error.
	 * Tests override this to assert error handling without polluting output.
	 */
	onBackgroundError?: (err: unknown) => void;
};

function buildAdapter(base: KnowledgeStore): SemanticStoreAdapter<KnowledgeEntry> {
	return {
		id: (entry) => entry.id,
		fingerprint: (entry) => entry.updated,
		indexableText: (entry) => {
			const tags = entry.tags.join(" ");
			const head = `${entry.title}\n${entry.type} ${tags}`;
			return `${head}\n${entry.content}`.trim();
		},
		readEntry: (id) => base.read(id),
		resolveStorageDir: (id) => base.entryDir(id),
		listStorageDirs: () => {
			const dirs: string[] = [];
			const project = base.getProjectDir();
			if (project) dirs.push(project);
			dirs.push(base.getGlobalDir());
			return dirs;
		},
	};
}

export class SemanticKnowledgeStore implements KnowledgeProvider {
	private base: KnowledgeStore;
	private manager: SemanticIndexManager<KnowledgeEntry>;

	constructor(options: SemanticKnowledgeStoreOptions) {
		this.base = options.base;
		const onError =
			options.onBackgroundError ??
			((err) =>
				console.error("[knowledge-semantic] background embed failed:", err));
		this.manager = new SemanticIndexManager({
			adapter: buildAdapter(options.base),
			provider: options.provider,
			onError,
		});
	}

	create(opts: Parameters<KnowledgeStore["create"]>[0]): string {
		const id = this.base.create(opts);
		this.manager.enqueueEmbed(id);
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
		if (ok) this.manager.enqueueEmbed(id);
		return ok;
	}

	delete(id: string): boolean {
		const dir = this.base.entryDir(id);
		const ok = this.base.delete(id);
		if (ok && dir) this.manager.removeFromIndex(dir, id);
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
		await this.manager.flush();
	}

	supportsSemanticSearch(): boolean {
		return true;
	}

	async semanticSearch(
		query: string,
		topK: number,
		filters?: SearchFilters,
	): Promise<KnowledgeEntry[]> {
		const entries = this.base.list(filters);
		return this.manager.rankBySimilarity(query, entries, topK);
	}

	async reindex(): Promise<ReindexResult> {
		return this.manager.rebuildIndex(this.base.list());
	}
}
