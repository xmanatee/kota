import type { MemoryListEntry } from "./client.js";

function formatDate(iso: string): string {
	return iso.slice(0, 16).replace("T", " ");
}

/**
 * Plain-text rendering of memory search results — one line per entry showing
 * id, created date, and a short content snippet. Used by surfaces (Telegram)
 * that cannot consume the structured rendering primitives `cli.ts` uses for
 * the terminal. Mirrors the column shape of `buildMemoryListNode` so the
 * operator sees the same id/date/content ordering across surfaces.
 */
export function renderMemorySearchPlain(entries: MemoryListEntry[]): string {
	const idWidth = Math.max(...entries.map((e) => e.id.length), 2);
	return entries
		.map((e) => {
			const snippet = e.content.replace(/\n/g, " ").slice(0, 60);
			return `${e.id.padEnd(idWidth)}  ${formatDate(e.created).padEnd(16)}  ${snippet}`;
		})
		.join("\n");
}
