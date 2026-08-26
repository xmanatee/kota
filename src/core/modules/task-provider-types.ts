import type { Task, TaskPriority, TaskStatus } from '#core/daemon/task-store.js';
import type { ReindexResult } from './work-provider-types.js';

export interface TaskMutationProvider {
	add(
		task: string,
		opts?: {
			parent_id?: number;
			priority?: TaskPriority;
			blocked_by?: number[];
			notes?: string;
		},
	): Promise<Task>;
	update(
		id: number,
		changes: {
			status?: TaskStatus;
			priority?: TaskPriority;
			blocked_by?: number[];
			notes?: string;
		},
	): Promise<Task>;
}

export interface TaskMaintenanceProvider {
	clear(): Promise<void>;
	archiveCompleted(): Promise<number>;
}

export interface TaskProvider {
	list(): Task[];
	active(): Task[];
	get(id: number): Task | undefined;
	getActiveSummary(): string | null;
	isEmpty(): boolean;
	count(): number;
}

export type TaskProviderRegistration = {
	provider: TaskProvider;
	mutations?: TaskMutationProvider;
	maintenance?: TaskMaintenanceProvider;
};

export type RepoTaskState =
	| "backlog"
	| "ready"
	| "doing"
	| "blocked"
	| "done"
	| "dropped";

/**
 * A single semantic-or-keyword search hit over the repo task queue. Mirrors
 * the metadata operator surfaces want without requiring a follow-up file
 * read. `score` is the cosine similarity for embedding-backed providers and
 * a deterministic keyword score for the substring/grep default.
 */
export type RepoTaskSearchHit = {
	id: string;
	title: string;
	state: RepoTaskState;
	priority: string;
	area: string;
	summary: string;
	updatedAt: string;
	score: number;
};

/** Options accepted by `RepoTasksProvider.searchTasks`. */
export type RepoTasksSearchOptions = {
	/** Restrict matches to the given states. Defaults to all states. */
	states?: ReadonlyArray<RepoTaskState>;
	/** Maximum hits returned, ranked by score. Defaults to 20. */
	topK?: number;
};

/**
 * Interface for the repo task queue's search/reindex seam.
 *
 * The default provider lives in the `repo-tasks` module and answers
 * substring/grep ranking. The `tasks-semantic` module registers an overriding
 * implementation that also declares embedding-backed semantic search.
 */
export interface RepoTasksProvider {
	readonly semanticSearchCapability?: RepoTasksSemanticSearchCapability;
	/**
	 * Rank tasks by relevance to a natural-language query. Embedding-backed
	 * providers throw if the embedding service is unreachable; callers that
	 * need a structured fallback wrap the call themselves.
	 */
	searchTasks(
		query: string,
		options?: RepoTasksSearchOptions,
	): Promise<RepoTaskSearchHit[]>;
}

export interface RepoTasksSemanticSearchCapability {
	searchTasks(
		query: string,
		options?: RepoTasksSearchOptions,
	): Promise<RepoTaskSearchHit[]>;
	reindex(): Promise<ReindexResult>;
}
