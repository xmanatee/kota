/**
 * Default `RepoTasksProvider` implementation.
 *
 * Answers search queries with substring/grep ranking against the same
 * `title + summary + body-sections` text the semantic provider indexes.
 * Operators that configure the `tasks-semantic` module receive an
 * embedding-backed override; without that, this implementation keeps
 * `kota task search --keyword` and the default search seam useful.
 */

import type {
	ReindexResult,
	RepoTaskSearchHit,
	RepoTaskState,
	RepoTasksProvider,
	RepoTasksSearchOptions,
} from "#core/modules/provider-types.js";
import {
	buildIndexableTaskText,
	listFullRepoTasks,
	REPO_TASK_STATES,
	type RepoTaskFullRecord,
} from "./repo-tasks-domain.js";

const DEFAULT_TOP_K = 20;

/**
 * Read every task record once and return ranked keyword hits. The score is
 * a deterministic count of case-insensitive query-token matches across the
 * indexable text, with title matches weighted higher so a query that names
 * the task surfaces it ahead of incidental body matches.
 */
export class RepoTasksDefaultStore implements RepoTasksProvider {
	constructor(private projectDir: string) {}

	supportsSemanticSearch(): boolean {
		return false;
	}

	async searchTasks(
		query: string,
		options?: RepoTasksSearchOptions,
	): Promise<RepoTaskSearchHit[]> {
		const trimmed = query.trim();
		if (!trimmed) return [];

		const states = normalizeStates(options?.states);
		const topK = options?.topK ?? DEFAULT_TOP_K;
		if (topK <= 0) return [];

		const records = listFullRepoTasks(this.projectDir, states);
		const tokens = tokenize(trimmed);
		if (tokens.length === 0) return [];

		const scored: RepoTaskSearchHit[] = [];
		for (const record of records) {
			const score = scoreKeyword(record, tokens);
			if (score <= 0) continue;
			scored.push({
				id: record.id,
				title: record.title,
				state: record.state,
				priority: record.priority,
				area: record.area,
				summary: record.summary,
				updatedAt: record.updatedAt,
				score,
			});
		}
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, topK);
	}

	async reindex(): Promise<ReindexResult> {
		return { indexed: 0, failed: 0, skipped: true };
	}
}

function normalizeStates(
	states?: ReadonlyArray<RepoTaskState>,
): RepoTaskState[] {
	if (!states || states.length === 0) return [...REPO_TASK_STATES];
	return [...states];
}

function tokenize(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length >= 2);
}

const TITLE_WEIGHT = 5;
const SUMMARY_WEIGHT = 3;
const BODY_WEIGHT = 1;

function scoreKeyword(record: RepoTaskFullRecord, tokens: string[]): number {
	const title = record.title.toLowerCase();
	const summary = record.summary.toLowerCase();
	const indexable = buildIndexableTaskText(record).toLowerCase();
	let score = 0;
	for (const token of tokens) {
		score += countOccurrences(title, token) * TITLE_WEIGHT;
		score += countOccurrences(summary, token) * SUMMARY_WEIGHT;
		score += countOccurrences(indexable, token) * BODY_WEIGHT;
	}
	return score;
}

function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let from = 0;
	while (true) {
		const idx = haystack.indexOf(needle, from);
		if (idx === -1) return count;
		count += 1;
		from = idx + needle.length;
	}
}
