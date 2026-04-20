/**
 * Memory Store — file-based persistent agent notes.
 *
 * Entries are stored as a single JSON file under `.kota/memory.json`
 * (or `~/.kota/memory.json` for the global default). Each entry carries an
 * id, content string, tag list, and ISO creation timestamp. The store
 * auto-prunes to the most recent `MAX_MEMORIES` entries on save.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Memory, ReindexResult } from "#core/modules/provider-types.js";

type MemoryFile = {
  memories: Memory[];
};

const MAX_MEMORIES = 100;

export class MemoryStore {
  private memories: Memory[] = [];
  private filePath: string;
  private loaded = false;

  constructor(dir?: string) {
    const base = dir || join(homedir(), ".kota");
    this.filePath = join(base, "memory.json");
  }

  /** Load memories from disk (lazy, once). */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const data: MemoryFile = JSON.parse(raw);
      this.memories = data.memories || [];
    } catch {
      // Corrupted file — start fresh
      this.memories = [];
    }
  }

  /** Persist memories to disk. */
  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data: MemoryFile = { memories: this.memories };
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  /** Save a new memory. Returns the assigned ID. */
  save(content: string, tags: string[] = []): string {
    this.ensureLoaded();
    const id = randomBytes(4).toString("hex");
    this.memories.push({
      id,
      content,
      tags,
      created: new Date().toISOString(),
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
  update(id: string, updates: { content?: string; tags?: string[] }): boolean {
    this.ensureLoaded();
    const memory = this.memories.find((m) => m.id === id);
    if (!memory) return false;
    if (updates.content !== undefined) memory.content = updates.content;
    if (updates.tags !== undefined) memory.tags = updates.tags;
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

  supportsSemanticSearch(): boolean {
    return false;
  }

  async semanticSearch(
    _query: string,
    _topK: number,
    _options?: { tag?: string; since?: string },
  ): Promise<Memory[]> {
    throw new Error("Semantic memory search requires an embedding-backed memory provider.");
  }

  async reindex(): Promise<ReindexResult> {
    return { indexed: 0, failed: 0, skipped: true };
  }
}

// Singleton for the memory tool, CLI, and routes to share.
let store: MemoryStore | undefined;

export function getMemoryStore(dir?: string): MemoryStore {
  if (!store) store = new MemoryStore(dir);
  return store;
}

export function resetMemoryStore(): void {
  store = undefined;
}
