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

export function decodeWorkingMemoryFile(value: unknown): {
  entries: WorkingMemoryEntry[];
  migrated: boolean;
} {
  const migrated = Array.isArray(value);
  const entries = migrated
    ? value
    : isRecord(value) && value.schemaVersion === WORKING_MEMORY_SCHEMA_VERSION
      ? value.entries
      : undefined;
  if (!Array.isArray(entries)) {
    throw new Error("Working memory storage has an unsupported or malformed schema");
  }
  return {
    migrated,
    entries: entries.map((entry, index) => decodeEntry(entry, index)),
  };
}

function decodeEntry(value: unknown, index: number): WorkingMemoryEntry {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    typeof value.value !== "string" ||
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
