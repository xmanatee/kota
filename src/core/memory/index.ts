/**
 * Memory subsystem — persistent memory, conversation history, working memory,
 * and context compaction. The file-based knowledge store is owned by the
 * `knowledge` module.
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
