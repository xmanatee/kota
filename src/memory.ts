import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

export type Memory = {
  id: string;
  content: string;
  tags: string[];
  created: string;
};

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
    const dir = this.filePath.replace(/\/[^/]+$/, "");
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

  /** Search memories by keyword (matches content and tags). */
  search(query: string): Memory[] {
    this.ensureLoaded();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return this.memories;

    return this.memories
      .map((m) => {
        const text = (m.content + " " + m.tags.join(" ")).toLowerCase();
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
}

// Singleton for the tool to use
let store: MemoryStore | undefined;

export function getMemoryStore(): MemoryStore {
  if (!store) store = new MemoryStore();
  return store;
}
