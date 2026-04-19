/**
 * Memory subsystem — persistent memory, knowledge store, conversation history,
 * working memory, and context compaction.
 */

export {
	COMPACTION_PROMPT,
	compactMessages,
	extractWorkingState,
} from "./compaction.js";
export {
	type ConversationData,
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
	setCompactionEnabled,
	setEntry,
	type WorkingMemoryEntry,
} from "./working-memory.js";
