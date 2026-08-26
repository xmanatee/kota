import type { Memory } from "#core/modules/provider-types.js";
import { parseWorkMemoryMetadata } from "#core/modules/work-memory-metadata.js";

export const MEMORY_FILE_SCHEMA_VERSION = 1 as const;

export type MemoryFile = {
  schemaVersion: typeof MEMORY_FILE_SCHEMA_VERSION;
  memories: Memory[];
};

export type DecodedMemoryFile = {
  file: MemoryFile;
  migrated: boolean;
};

export class MemoryFileDecodeError extends Error {
  constructor(
    readonly reason: "invalid_root" | "unsupported_version" | "invalid_memories" | "invalid_entry",
    message: string,
  ) {
    super(message);
    this.name = "MemoryFileDecodeError";
  }
}

/** Decode the durable memory document and migrate the unversioned v0 shape. */
export function decodeMemoryFile(value: unknown): DecodedMemoryFile {
  if (!isRecord(value)) {
    throw new MemoryFileDecodeError("invalid_root", "memory file must contain an object");
  }
  const version = value.schemaVersion;
  if (version !== undefined && version !== MEMORY_FILE_SCHEMA_VERSION) {
    throw new MemoryFileDecodeError(
      "unsupported_version",
      `unsupported memory schema version: ${String(version)}`,
    );
  }
  if (!Array.isArray(value.memories)) {
    throw new MemoryFileDecodeError("invalid_memories", "memory file must contain a memories array");
  }
  const memories = value.memories.map((entry, index) => decodeMemory(entry, index));
  return {
    file: { schemaVersion: MEMORY_FILE_SCHEMA_VERSION, memories },
    migrated: version === undefined,
  };
}

function decodeMemory(value: unknown, index: number): Memory {
  if (!isRecord(value)) return invalidEntry(index, "must be an object");
  if (typeof value.id !== "string" || value.id.length === 0) {
    return invalidEntry(index, "id must be a non-empty string");
  }
  if (typeof value.content !== "string") {
    return invalidEntry(index, "content must be a string");
  }
  if (!Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) {
    return invalidEntry(index, "tags must be an array of strings");
  }
  const created = decodeTimestamp(value.created, index, "created");
  const updated = value.updated === undefined
    ? created
    : decodeTimestamp(value.updated, index, "updated");
  const metadata = parseWorkMemoryMetadata({
    provenance: value.provenance ?? null,
    freshness: value.freshness ?? null,
  });
  if (!metadata.ok) return invalidEntry(index, metadata.message);
  return {
    id: value.id,
    content: value.content,
    tags: value.tags,
    created,
    updated,
    ...(metadata.metadata?.provenance && { provenance: metadata.metadata.provenance }),
    ...(metadata.metadata?.freshness && { freshness: metadata.metadata.freshness }),
  };
}

function decodeTimestamp(value: unknown, index: number, field: string): string {
  if (typeof value !== "string") return invalidEntry(index, `${field} must be an ISO timestamp`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return invalidEntry(index, `${field} must be an ISO timestamp`);
  return date.toISOString();
}

function invalidEntry(index: number, message: string): never {
  throw new MemoryFileDecodeError("invalid_entry", `memory entry ${index}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
