/**
 * SemanticTasksStore — `RepoTasksProvider` variant backed by the shared
 * embedding-index engine. Delegates listing to the underlying default
 * implementation and answers `searchTasks` with embedding-backed cosine
 * ranking. The sidecar `.embeddings.json` lives under
 * `<projectDir>/.kota/tasks-semantic/` so it stays out of the git-tracked
 * `data/tasks/` tree (the file is a runtime cache, not source state).
 *
 * Staleness is detected via each task's frontmatter `updated_at` ISO
 * timestamp, which `pnpm kota task move|create` already maintains.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
	ReindexResult,
	RepoTaskSearchHit,
	RepoTasksProvider,
	RepoTasksSearchOptions,
} from "#core/modules/provider-types.js";
import {
	buildIndexableTaskText,
	listFullRepoTasks,
	REPO_TASK_STATES,
	type RepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import type { EmbeddingProvider } from "#modules/semantic-index/embedding-provider.js";
import {
	SemanticIndexManager,
	type SemanticStoreAdapter,
} from "#modules/semantic-index/semantic-index-manager.js";

export const TASKS_SIDECAR_DIRNAME = "tasks-semantic";

export type SemanticTasksStoreOptions = {
	projectDir: string;
	provider: EmbeddingProvider;
	/**
	 * Called when background embedding fails. Defaults to console.error.
	 * Tests override this to assert error handling without polluting output.
	 */
	onBackgroundError?: (err: unknown) => void;
};

const DEFAULT_TOP_K = 20;

export function tasksSidecarDir(projectDir: string): string {
	return join(projectDir, ".kota", TASKS_SIDECAR_DIRNAME);
}

function buildAdapter(
	projectDir: string,
	sidecarDir: string,
): SemanticStoreAdapter<RepoTaskFullRecord> {
	const findById = (id: string): RepoTaskFullRecord | null => {
		const all = listFullRepoTasks(projectDir);
		return all.find((entry) => entry.id === id) ?? null;
	};
	return {
		id: (entry) => entry.id,
		fingerprint: (entry) => entry.updatedAt,
		indexableText: (entry) => buildIndexableTaskText(entry),
		readEntry: (id) => findById(id),
		resolveStorageDir: () => sidecarDir,
		listStorageDirs: () => [sidecarDir],
	};
}

export class SemanticTasksStore implements RepoTasksProvider {
	private projectDir: string;
	private sidecarDir: string;
	private manager: SemanticIndexManager<RepoTaskFullRecord>;

	constructor(options: SemanticTasksStoreOptions) {
		this.projectDir = options.projectDir;
		this.sidecarDir = tasksSidecarDir(options.projectDir);
		mkdirSync(this.sidecarDir, { recursive: true });
		const onError =
			options.onBackgroundError ??
			((err) =>
				console.error("[tasks-semantic] background embed failed:", err));
		this.manager = new SemanticIndexManager({
			adapter: buildAdapter(this.projectDir, this.sidecarDir),
			provider: options.provider,
			onError,
		});
	}

	supportsSemanticSearch(): boolean {
		return true;
	}

	async searchTasks(
		query: string,
		options?: RepoTasksSearchOptions,
	): Promise<RepoTaskSearchHit[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];
		const states = options?.states && options.states.length > 0
			? [...options.states]
			: [...REPO_TASK_STATES];
		const topK = options?.topK ?? DEFAULT_TOP_K;
		if (topK <= 0) return [];
		const candidates = listFullRepoTasks(this.projectDir, states);
		const ranked = await this.manager.rankBySimilarityScored(
			trimmed,
			candidates,
			topK,
		);
		return ranked.map(({ entry, score }) => ({
			id: entry.id,
			title: entry.title,
			state: entry.state,
			priority: entry.priority,
			area: entry.area,
			summary: entry.summary,
			updatedAt: entry.updatedAt,
			score,
		}));
	}

	async reindex(): Promise<ReindexResult> {
		const records = listFullRepoTasks(this.projectDir);
		return this.manager.rebuildIndex(records);
	}

	/** Wait for all pending background embeds to settle. (Test helper.) */
	async flush(): Promise<void> {
		await this.manager.flush();
	}
}
