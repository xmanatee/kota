/**
 * Memory Store — file-based persistent agent notes.
 *
 * Entries are stored as a single JSON file under `.kota/memory.json`
 * (or `~/.kota/memory.json` for the global default). Each entry carries an
 * id, content string, tag list, and ISO creation timestamp. The store
 * auto-prunes to the most recent `MAX_MEMORIES` entries on save.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Memory } from "#core/modules/provider-types.js";
import {
	parseWorkMemoryMetadata,
	type WorkMemoryMetadata,
} from "#core/modules/work-memory-metadata.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";

import {
  decodeMemoryFile,
  MEMORY_FILE_SCHEMA_VERSION,
  type MemoryFile,
  MemoryFileDecodeError,
} from "./persistence.js";

const MAX_MEMORIES = 100;

export class MemoryStore {
  private memories: Memory[] = [];
  private filePath: string;
  private loaded = false;
  private loadError: MemoryStoreLoadError | null = null;

  constructor(dir?: string) {
    const base = dir || join(homedir(), ".kota");
    this.filePath = join(base, "memory.json");
  }

  /** Load memories from disk (lazy, once). */
  private ensureLoaded(): void {
    if (this.loaded) {
      if (this.loadError) throw this.loadError;
      return;
    }
    this.loaded = true;
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const decoded = decodeMemoryFile(JSON.parse(raw) as unknown);
      this.memories = decoded.file.memories;
      if (decoded.migrated) this.persist();
    } catch (error) {
      this.loadError = new MemoryStoreLoadError(
        this.filePath,
        error instanceof SyntaxError
          ? "invalid_json"
          : error instanceof MemoryFileDecodeError
            ? error.reason
            : "read_failed",
        error instanceof Error ? error.message : String(error),
      );
      throw this.loadError;
    }
  }

  /** Persist memories to disk. */
  private persist(): void {
    const data: MemoryFile = {
      schemaVersion: MEMORY_FILE_SCHEMA_VERSION,
      memories: this.memories,
    };
    writeJsonFileAtomic(this.filePath, data);
  }

  /** Save a new memory. Returns the assigned ID. */
  save(
    content: string,
    tags: string[] = [],
    metadata?: WorkMemoryMetadata,
  ): string {
    this.ensureLoaded();
    const id = randomBytes(4).toString("hex");
    const now = new Date().toISOString();
    const normalizedMetadata = normalizeWorkMemoryMetadata(metadata);
    this.memories.push({
      id,
      content,
      tags,
      created: now,
      updated: now,
      ...(normalizedMetadata?.provenance && {
        provenance: normalizedMetadata.provenance,
      }),
      ...(normalizedMetadata?.freshness && {
        freshness: normalizedMetadata.freshness,
      }),
    });
    // Auto-prune oldest if over limit
    if (this.memories.length > MAX_MEMORIES) {
      this.memories = this.memories.slice(-MAX_MEMORIES);
    }
    this.persist();
    return id;
  }

  /** Search memories by keyword, with optional tag and time filters. */
  search(query: string, options?: { tag?: string; since?: string }): Memory[] {
    this.ensureLoaded();
    let pool = this.memories;

    if (options?.tag) {
      const tagLower = options.tag.toLowerCase();
      pool = pool.filter((m) => m.tags.some((t) => t.toLowerCase() === tagLower));
    }
    if (options?.since) {
      const sinceDate = new Date(options.since).getTime();
      if (!Number.isNaN(sinceDate)) {
        pool = pool.filter((m) => new Date(m.created).getTime() >= sinceDate);
      }
    }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return pool;

    return pool
      .map((m) => {
        const text = (`${m.content} ${m.tags.join(" ")}`).toLowerCase();
        const hits = terms.filter((t) => text.includes(t)).length;
        return { memory: m, score: hits / terms.length };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.memory);
  }

  /** List all memories. */
  list(): Memory[] {
    this.ensureLoaded();
    return this.memories;
  }

  /** Update an existing memory's content or tags. Returns true if found. */
  update(
    id: string,
    updates: {
      content?: string;
      tags?: string[];
      provenance?: Memory["provenance"] | null;
      freshness?: Memory["freshness"] | null;
    },
  ): boolean {
    this.ensureLoaded();
    const memory = this.memories.find((m) => m.id === id);
    if (!memory) return false;
    if (updates.content !== undefined) memory.content = updates.content;
    if (updates.tags !== undefined) memory.tags = updates.tags;
    if (updates.provenance !== undefined) {
      if (updates.provenance === null) delete memory.provenance;
      else memory.provenance = updates.provenance;
    }
    if (updates.freshness !== undefined) {
      if (updates.freshness === null) delete memory.freshness;
      else memory.freshness = updates.freshness;
    }
    memory.updated = new Date().toISOString();
    this.persist();
    return true;
  }

  /** Delete a memory by ID. Returns true if found. */
  delete(id: string): boolean {
    this.ensureLoaded();
    const before = this.memories.length;
    this.memories = this.memories.filter((m) => m.id !== id);
    if (this.memories.length < before) {
      this.persist();
      return true;
    }
    return false;
  }

  /** Storage directory that holds `memory.json` and any sidecar indexes. */
  getStorageDir(): string {
    return dirname(this.filePath);
  }

}

export class MemoryStoreLoadError extends Error {
  constructor(
    readonly path: string,
    readonly reason:
      | "invalid_json"
      | "invalid_root"
      | "unsupported_version"
      | "invalid_memories"
      | "invalid_entry"
      | "read_failed",
    message: string,
  ) {
    super(`Cannot load memory store ${path}: ${message}`);
    this.name = "MemoryStoreLoadError";
  }
}

export function getScopeMemoryStore(scopeRoot: string): MemoryStore {
  return new MemoryStore(join(scopeRoot, ".kota"));
}

function normalizeWorkMemoryMetadata(
  metadata: WorkMemoryMetadata | undefined,
): WorkMemoryMetadata | undefined {
  if (!metadata) return undefined;
  const parsed = parseWorkMemoryMetadata({
    provenance: metadata.provenance ?? null,
    freshness: metadata.freshness ?? null,
  });
  return parsed.ok ? parsed.metadata : undefined;
}
