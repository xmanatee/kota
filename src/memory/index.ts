/**
 * Memory subsystem — persistent memory, knowledge store, conversation history,
 * working memory, context compaction, and SQLite-backed memory provider.
 */

export {
	COMPACTION_PROMPT,
	compactMessages,
	extractWorkingState,
} from "./compaction.js";
export {
	ConversationHistory,
	type ConversationRecord,
	generateTitle,
	getHistory,
	resetHistory,
} from "./history.js";
export {
	getKnowledgeStore,
	type KnowledgeEntry,
	KnowledgeStore,
	parseFrontMatter,
	resetKnowledgeStore,
	type SearchFilters,
	serializeFrontMatter,
	toSlug,
} from "./knowledge-store.js";
export { SQLiteMemoryProvider } from "./sqlite-memory.js";
export { getMemoryStore, type Memory, MemoryStore } from "./store.js";
export {
	clearAll,
	getEntry,
	getPersistentEntries,
	getWorkingMemoryState,
	listEntries,
	loadEntries,
	removeEntry,
	resetWorkingMemory,
	setEntry,
	type WorkingMemoryEntry,
} from "./working-memory.js";
