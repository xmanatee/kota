/**
 * SemanticKnowledgeStore — KnowledgeProvider variant backed by the shared
 * embedding-index engine. CRUD delegates to the base store; writes enqueue
 * background embed work; queries lazily fill the index, cosine-rank the
 * results, and surface embedding errors to the caller.
 *
 * Staleness is detected via each entry's `updated` ISO timestamp, which the
 * base store already bumps on every write.
 */

import type {
	KnowledgeEntry,
	KnowledgeProvider,
	KnowledgeSemanticSearchCapability,
	SearchFilters,
} from "#core/modules/provider-types.js";
import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import type { KnowledgeStore } from "#modules/knowledge/store.js";
import type { EmbeddingProvider } from "#modules/semantic-index/embedding-provider.js";
import {
	type ReindexResult,
	SemanticIndexManager,
	type SemanticStoreAdapter,
	type SemanticStoreCapabilities,
} from "#modules/semantic-index/semantic-index-manager.js";

export type SemanticKnowledgeStoreOptions = {
	base: KnowledgeStore;
	provider: EmbeddingProvider;
	/**
	 * Called when background embedding fails. Defaults to a terminal diagnostic.
	 * Tests override this to assert error handling without polluting output.
	 */
	onBackgroundError?: (err: unknown) => void;
};

function buildAdapter(base: KnowledgeStore): SemanticStoreAdapter<KnowledgeEntry> {
	return {
		capabilities: {
			mutation: true,
			deletion: true,
			reindex: true,
			search: true,
		},
		id: (entry) => entry.id,
		fingerprint: (entry) => entry.updated,
		indexableText: (entry) => {
			const tags = entry.tags.join(" ");
			const head = `${entry.title}\n${entry.type} ${tags}`;
			return `${head}\n${entry.content}`.trim();
		},
		readEntry: (id) => base.read(id),
		listEntries: () => base.list(),
		resolveStorageDir: (id) => base.entryDir(id),
		listStorageDirs: () => {
			const dirs: string[] = [];
			const scope = base.getScopeDir();
			if (scope) dirs.push(scope);
			dirs.push(base.getGlobalDir());
			return dirs;
		},
	};
}

export class SemanticKnowledgeStore implements KnowledgeProvider, KnowledgeSemanticSearchCapability {
	readonly capabilities: SemanticStoreCapabilities;
	readonly semanticSearchCapability: KnowledgeSemanticSearchCapability = this;
	private base: KnowledgeStore;
	private manager: SemanticIndexManager<KnowledgeEntry>;

	constructor(options: SemanticKnowledgeStoreOptions) {
		this.base = options.base;
		const onError =
			options.onBackgroundError ??
			((err) =>
				printTerminalDiagnostic(
					"[knowledge-semantic] background embed failed:",
					"error",
					err instanceof Error ? err.message : String(err),
				));
		this.manager = new SemanticIndexManager({
			adapter: buildAdapter(options.base),
			provider: options.provider,
			onError,
		});
		this.capabilities = this.manager.capabilities;
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
		const ok = this.base.delete(id);
		if (ok) this.manager.removeFromIndex(id);
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

	async semanticSearch(
		query: string,
		topK: number,
		filters?: SearchFilters,
	): Promise<KnowledgeEntry[]> {
		const entries = this.base.list(filters);
		return this.manager.rankBySimilarity(query, entries, topK);
	}

	async reindex(): Promise<ReindexResult> {
		return this.manager.reindex();
	}
}
