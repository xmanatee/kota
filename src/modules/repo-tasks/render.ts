import type { RepoTaskSearchHit } from "#core/modules/provider-types.js";

/**
 * Plain-text rendering of repo-task search hits — one line per hit showing
 * id, state, priority, and title. Used by surfaces that cannot consume the
 * structured rendering primitives (terminal `kota task search` consumes
 * this directly via `line(plain(...))`). Mirrors `renderHistorySearchPlain`
 * / `renderMemorySearchPlain` so the operator sees the same line shape
 * across surfaces.
 */
export function renderRepoTaskSearchPlain(hits: RepoTaskSearchHit[]): string {
	if (hits.length === 0) return "";
	const idWidth = Math.max(...hits.map((h) => h.id.length), 2);
	const stateWidth = Math.max(...hits.map((h) => h.state.length), 5);
	const prioWidth = Math.max(...hits.map((h) => h.priority.length), 4);
	return hits
		.map((hit) => {
			const id = hit.id.padEnd(idWidth);
			const state = hit.state.padEnd(stateWidth);
			const priority = hit.priority.padEnd(prioWidth);
			return `${id}  ${state}  ${priority}  ${hit.title}`;
		})
		.join("\n");
}
