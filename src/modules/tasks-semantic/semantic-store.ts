/**
 * SemanticTasksStore — `RepoTasksProvider` variant backed by the shared
 * embedding-index engine. Delegates listing to the underlying default
 * implementation and answers `searchTasks` with embedding-backed cosine
 * ranking. The sidecar `.embeddings.json` lives under
 * `<scopeRoot>/.kota/tasks-semantic/` so it stays out of the git-tracked
 * `data/tasks/` tree (the file is a runtime cache, not source state).
 *
 * Staleness is detected from a hash of the canonical persisted task fields.
 */

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
	ReindexResult,
	RepoTaskSearchHit,
	RepoTasksProvider,
	RepoTasksSearchOptions,
	RepoTasksSemanticSearchCapability,
} from "#core/modules/provider-types.js";
import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
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
	scopeRoot: string;
	provider: EmbeddingProvider;
	/**
	 * Called when background embedding fails. Defaults to a terminal diagnostic.
	 * Tests override this to assert error handling without polluting output.
	 */
	onBackgroundError?: (err: unknown) => void;
};

const DEFAULT_TOP_K = 20;

export function tasksSidecarDir(scopeRoot: string): string {
	return join(scopeRoot, ".kota", TASKS_SIDECAR_DIRNAME);
}

function buildAdapter(
	scopeRoot: string,
	sidecarDir: string,
): SemanticStoreAdapter<RepoTaskFullRecord> {
	const findById = (id: string): RepoTaskFullRecord | null => {
		const all = listFullRepoTasks(scopeRoot);
		return all.find((entry) => entry.id === id) ?? null;
	};
	return {
		id: (entry) => entry.id,
		fingerprint: (entry) => createHash("sha256")
			.update(JSON.stringify({ state: entry.state, priority: entry.priority, body: entry.body, dependsOn: entry.dependsOn }))
			.digest("hex"),
		indexableText: (entry) => buildIndexableTaskText(entry),
		readEntry: (id) => findById(id),
		resolveStorageDir: () => sidecarDir,
		listStorageDirs: () => [sidecarDir],
	};
}

export class SemanticTasksStore implements RepoTasksProvider, RepoTasksSemanticSearchCapability {
	readonly semanticSearchCapability: RepoTasksSemanticSearchCapability = this;
	private scopeRoot: string;
	private sidecarDir: string;
	private manager: SemanticIndexManager<RepoTaskFullRecord>;

	constructor(options: SemanticTasksStoreOptions) {
		this.scopeRoot = options.scopeRoot;
		this.sidecarDir = tasksSidecarDir(options.scopeRoot);
			mkdirSync(this.sidecarDir, { recursive: true });
			const onError =
				options.onBackgroundError ??
				((err) =>
					printTerminalDiagnostic(
						"[tasks-semantic] background embed failed:",
						"error",
						err instanceof Error ? err.message : String(err),
					));
			this.manager = new SemanticIndexManager({
			adapter: buildAdapter(this.scopeRoot, this.sidecarDir),
			provider: options.provider,
			onError,
		});
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
		const candidates = listFullRepoTasks(this.scopeRoot, states);
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
			score,
		}));
	}

	async reindex(): Promise<ReindexResult> {
		const records = listFullRepoTasks(this.scopeRoot);
		return this.manager.rebuildIndex(records);
	}

	/** Wait for all pending background embeds to settle. (Test helper.) */
	async flush(): Promise<void> {
		await this.manager.flush();
	}
}
