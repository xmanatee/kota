import type { ModuleStorage } from "#core/modules/module-storage.js";
import type { WorkingMemoryEntry } from "./store.js";

const WORKING_MEMORY_SCHEMA_VERSION = 1;

type StoredWorkingMemoryEntry = Pick<WorkingMemoryEntry, "key" | "value" | "updatedAt">;

export type WorkingMemoryFile = {
  schemaVersion: typeof WORKING_MEMORY_SCHEMA_VERSION;
  entries: StoredWorkingMemoryEntry[];
};

export function encodeWorkingMemoryFile(
  entries: readonly WorkingMemoryEntry[],
): WorkingMemoryFile {
  return {
    schemaVersion: WORKING_MEMORY_SCHEMA_VERSION,
    entries: entries.map(({ key, value, updatedAt }) => ({ key, value, updatedAt })),
  };
}

export function decodeWorkingMemoryFile(value: unknown): WorkingMemoryEntry[] {
  const entries = isRecord(value) && value.schemaVersion === WORKING_MEMORY_SCHEMA_VERSION
    ? value.entries
    : undefined;
  if (!Array.isArray(entries)) {
    throw new Error("Working memory storage has an unsupported or malformed schema");
  }
  const decoded = entries.map((entry, index) => decodeEntry(entry, index));
  if (new Set(decoded.map((entry) => entry.key)).size !== decoded.length) {
    throw new Error("Working memory storage contains duplicate keys");
  }
  return decoded;
}

export function readPersistentEntries(storage: ModuleStorage): WorkingMemoryEntry[] {
  const raw = storage.getJSON("entries");
  if (Array.isArray(raw)) {
    const entries = decodeWorkingMemoryFile({ schemaVersion: WORKING_MEMORY_SCHEMA_VERSION, entries: raw });
    // Validate the entire old file before atomically replacing it with the canonical envelope.
    storage.setJSON("entries", encodeWorkingMemoryFile(entries));
    return entries;
  }
  return raw === undefined ? [] : decodeWorkingMemoryFile(raw);
}

/** Synchronous read/merge/write keeps concurrent live sessions from publishing stale snapshots. */
export function updatePersistentEntries(
  storage: ModuleStorage,
  replacedKeys: readonly string[],
  entries: readonly WorkingMemoryEntry[] = [],
): void {
  const current = new Map(readPersistentEntries(storage).map((entry) => [entry.key, entry]));
  for (const key of replacedKeys) current.delete(key);
  for (const entry of entries) current.set(entry.key, entry);
  if (current.size === 0) storage.delete("entries");
  else storage.setJSON("entries", encodeWorkingMemoryFile([...current.values()]));
}

function decodeEntry(value: unknown, index: number): WorkingMemoryEntry {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    value.key.length === 0 || value.key.length > 80 ||
    typeof value.value !== "string" ||
    value.value.length > 500 ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt)
  ) {
    throw new Error(`Working memory entry ${index} is malformed`);
  }
  return {
    key: value.key,
    value: value.value,
    updatedAt: value.updatedAt,
    persistent: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
