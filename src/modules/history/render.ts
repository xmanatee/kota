import type { ConversationRecord } from "#core/modules/provider-types.js";

function formatDate(iso: string): string {
	return iso.slice(0, 16).replace("T", " ");
}

/**
 * Plain-text rendering of history search results — one line per
 * conversation showing id, updated date, message count, and title. Used
 * by surfaces (Telegram, mobile, macOS) that cannot consume the
 * structured rendering primitives `cli-commands.ts` uses for the
 * terminal. Mirrors `renderMemorySearchPlain` /
 * `renderKnowledgeSearchPlain` so the operator sees the same line shape
 * across surfaces.
 */
export function renderHistorySearchPlain(conversations: ConversationRecord[]): string {
	const idWidth = Math.max(...conversations.map((c) => c.id.length), 2);
	return conversations
		.map((c) => {
			const updated = formatDate(c.updatedAt).padEnd(16);
			const msgs = `${String(c.messageCount).padStart(4)} msgs`;
			return `${c.id.padEnd(idWidth)}  ${updated}  ${msgs}  ${c.title}`;
		})
		.join("\n");
}
