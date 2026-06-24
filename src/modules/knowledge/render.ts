import type { KnowledgeEntry } from "#core/modules/provider-types.js";
import { formatWorkMemoryMetadata } from "#core/modules/work-memory-metadata.js";

/**
 * Plain-text rendering of knowledge search results — one line per entry
 * showing id, type, status, and title. Used by surfaces (Telegram) that
 * cannot consume the structured rendering primitives `cli.ts` uses for
 * the terminal. Mirrors the column shape of `buildKnowledgeSearchNode`
 * so the operator sees the same id/type ordering across surfaces.
 */
export function renderKnowledgeSearchPlain(entries: KnowledgeEntry[]): string {
	const idWidth = Math.max(...entries.map((e) => e.id.length), 2);
	const typeWidth = Math.max(...entries.map((e) => e.type.length), 4);
	const statusWidth = Math.max(...entries.map((e) => e.status.length), 6);
	return entries
		.map((e) => {
			const metadata = formatWorkMemoryMetadata({
				...(e.provenance && { provenance: e.provenance }),
				...(e.freshness && { freshness: e.freshness }),
			});
			const suffix = metadata ? `  | ${metadata}` : "";
			return `${e.id.padEnd(idWidth)}  ${e.type.padEnd(typeWidth)}  ${e.status.padEnd(statusWidth)}  ${e.title}${suffix}`;
		})
		.join("\n");
}
