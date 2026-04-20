/**
 * Memory subsystem — conversation history, working memory, and context
 * compaction. The file-based memory store is owned by the `memory` module;
 * the file-based knowledge store is owned by the `knowledge` module.
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
