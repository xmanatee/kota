import type {
	WorkMemoryFreshness,
	WorkMemoryMetadata,
	WorkMemoryProvenance,
} from './work-memory-metadata.js';

export type Memory = {
	id: string;
	content: string;
	tags: string[];
	created: string;
	updated?: string;
	provenance?: WorkMemoryProvenance;
	freshness?: WorkMemoryFreshness;
};

/** A knowledge base entry: structured markdown with YAML front matter. */
export type KnowledgeEntry = {
	id: string;
	title: string;
	type: string;
	tags: string[];
	status: string;
	created: string;
	updated: string;
	content: string;
	provenance?: WorkMemoryProvenance;
	freshness?: WorkMemoryFreshness;
	/** Extra metadata fields not covered by the core schema. */
	meta: Record<string, string>;
};

/** Filters for knowledge search and list operations. */
export type SearchFilters = {
	type?: string;
	tag?: string;
	status?: string;
	since?: string;
	scope?: "scope" | "global" | "all";
};

/** Result of rebuilding the semantic search index. */
export type ReindexResult = {
	indexed: number;
	failed: number;
};

export type ReindexOperationResult =
	| ({ ok: true } & ReindexResult)
	| { ok: false; reason: "semantic_unavailable" };

/** Interface for persistent memory storage (save/search/list/update/delete). */
export interface MemoryProvider {
	readonly semanticSearchCapability?: MemorySemanticSearchCapability;
	save(
		content: string,
		tags?: string[],
		metadata?: WorkMemoryMetadata,
	): string;
	search(query: string, options?: { tag?: string; since?: string }): Memory[];
	list(): Memory[];
	update(
		id: string,
		updates: {
			content?: string;
			tags?: string[];
			provenance?: WorkMemoryProvenance | null;
			freshness?: WorkMemoryFreshness | null;
		},
	): boolean;
	delete(id: string): boolean;
}

/** Optional embedding-backed operations declared by capable memory providers. */
export interface MemorySemanticSearchCapability {
	/**
	 * Rank entries by semantic similarity to a natural-language query.
	 * Only embedding-backed providers should return results here.
	 */
	semanticSearch(
		query: string,
		topK: number,
		options?: { tag?: string; since?: string },
	): Promise<Memory[]>;
	/**
	 * Rebuild the semantic index over all entries.
	 */
	reindex(): Promise<ReindexResult>;
}

/** Interface for structured knowledge storage (CRUD + search over entries). */
export interface KnowledgeProvider {
	readonly semanticSearchCapability?: KnowledgeSemanticSearchCapability;
	create(opts: {
		title: string;
		content: string;
		type?: string;
		tags?: string[];
		status?: string;
		scope?: "scope" | "global";
		meta?: Record<string, string>;
		provenance?: WorkMemoryProvenance;
		freshness?: WorkMemoryFreshness;
	}): string;
	read(id: string): KnowledgeEntry | null;
	update(
		id: string,
		changes: {
			title?: string;
			content?: string;
			type?: string;
			tags?: string[];
			status?: string;
			meta?: Record<string, string>;
			provenance?: WorkMemoryProvenance | null;
			freshness?: WorkMemoryFreshness | null;
		},
	): boolean;
	delete(id: string): boolean;
	search(query: string, filters?: SearchFilters): KnowledgeEntry[];
	list(filters?: SearchFilters): KnowledgeEntry[];
	count(type?: string): number;
}

/** Optional embedding-backed operations declared by capable knowledge providers. */
export interface KnowledgeSemanticSearchCapability {
	/**
	 * Rank entries by semantic similarity to a natural-language query.
	 * Only embedding-backed providers should return results here.
	 */
	semanticSearch(
		query: string,
		topK: number,
		filters?: SearchFilters,
	): Promise<KnowledgeEntry[]>;
	/**
	 * Rebuild the semantic index over all entries.
	 */
	reindex(): Promise<ReindexResult>;
}


/** Interface for persistent task storage (add/update/list/get/clear). */
