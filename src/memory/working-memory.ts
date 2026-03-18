/**
 * Working Memory Store — explicit, editable scratchpad for the agent.
 *
 * Inspired by Letta/MemGPT's memory blocks: named entries that persist
 * in the system prompt across turns, giving the agent direct control
 * over what stays "on its desk" during a session.
 *
 * Session-scoped (in-memory only). For cross-session persistence, use
 * the knowledge store or memory system instead.
 */

const MAX_ENTRIES = 20;
const MAX_VALUE_LENGTH = 500;
const MAX_TOTAL_CHARS = 4000;

export type WorkingMemoryEntry = {
	key: string;
	value: string;
	updatedAt: number;
	/** If true, entry survives session restarts via module storage. */
	persistent?: boolean;
};

let store: Map<string, WorkingMemoryEntry> | null = null;

function getStore(): Map<string, WorkingMemoryEntry> {
	if (!store) store = new Map();
	return store;
}

export function setEntry(
	key: string,
	value: string,
	persistent?: boolean,
): string | null {
	const s = getStore();
	if (key.length > 80) return "Key must be 80 chars or less";
	if (value.length > MAX_VALUE_LENGTH)
		return `Value must be ${MAX_VALUE_LENGTH} chars or less`;
	if (!s.has(key) && s.size >= MAX_ENTRIES)
		return `Working memory full (max ${MAX_ENTRIES} entries). Remove an entry first.`;

	// Check total size won't exceed limit
	const existing = s.get(key);
	const currentTotal = totalChars(s);
	const delta = value.length - (existing?.value.length ?? 0);
	if (currentTotal + delta > MAX_TOTAL_CHARS)
		return `Would exceed total size limit (${MAX_TOTAL_CHARS} chars). Shorten value or remove entries.`;

	s.set(key, {
		key,
		value,
		updatedAt: Date.now(),
		persistent: persistent ?? existing?.persistent,
	});
	return null;
}

/**
 * Load entries in bulk (for restoring persisted entries on startup).
 * Skips entries that would violate limits.
 */
export function loadEntries(entries: WorkingMemoryEntry[]): number {
	let loaded = 0;
	for (const e of entries) {
		const err = setEntry(e.key, e.value, e.persistent);
		if (!err) loaded++;
	}
	return loaded;
}

/** Get all entries marked as persistent. */
export function getPersistentEntries(): WorkingMemoryEntry[] {
	return [...getStore().values()].filter((e) => e.persistent);
}

export function getEntry(key: string): WorkingMemoryEntry | undefined {
	return getStore().get(key);
}

export function removeEntry(key: string): boolean {
	return getStore().delete(key);
}

export function listEntries(): WorkingMemoryEntry[] {
	return [...getStore().values()].sort((a, b) => a.updatedAt - b.updatedAt);
}

export function clearAll(): number {
	const s = getStore();
	const count = s.size;
	s.clear();
	return count;
}

function totalChars(s: Map<string, WorkingMemoryEntry>): number {
	let total = 0;
	for (const e of s.values()) total += e.key.length + e.value.length;
	return total;
}

/**
 * Render working memory for injection into the dynamic system prompt.
 * Returns empty string when memory is empty (no prompt overhead).
 */
export function getWorkingMemoryState(): string {
	const entries = listEntries();
	if (entries.length === 0) return "";
	const lines = entries.map((e) => {
		const tag = e.persistent ? " ★" : "";
		return `- **${e.key}**: ${e.value}${tag}`;
	});
	return `\n\n<working-memory>\n${lines.join("\n")}\n</working-memory>`;
}

/** Reset store — for testing. */
export function resetWorkingMemory(): void {
	store = null;
}
