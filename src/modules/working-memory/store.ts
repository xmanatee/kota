import type { ModuleStorage } from "#core/modules/module-storage.js";
import { readPersistentEntries, updatePersistentEntries } from "./persistence.js";

const MAX_ENTRIES = 20;
const MAX_VALUE_LENGTH = 500;
const MAX_TOTAL_CHARS = 4000;
const COMPACT_ENTRY_THRESHOLD = 16;
const COMPACT_CHAR_THRESHOLD = MAX_TOTAL_CHARS * 0.8;
const COMPACT_TRUNCATE_LENGTH = 200;

export type WorkingMemoryEntry = {
  key: string;
  value: string;
  updatedAt: number;
  persistent?: boolean;
};

/** One session's scratchpad. Only explicit persistent mutations reach scope storage. */
export class WorkingMemoryStore {
  private readonly entries = new Map<string, WorkingMemoryEntry>();
  private compactionEnabled = true;

  constructor(private readonly storage?: ModuleStorage) {
    if (storage) this.loadEntries(readPersistentEntries(storage));
  }

  private validateEntry(key: string, value: string): string | null {
    if (key.length > 80) return "Key must be 80 chars or less";
    if (value.length > MAX_VALUE_LENGTH) return `Value must be ${MAX_VALUE_LENGTH} chars or less`;
    const existing = this.entries.get(key);
    if (!existing && this.entries.size >= MAX_ENTRIES) {
      return `Working memory full (max ${MAX_ENTRIES} entries). Remove an entry first.`;
    }
    const delta = key.length + value.length - (existing ? existing.key.length + existing.value.length : 0);
    if (this.totalChars() + delta > MAX_TOTAL_CHARS) {
      return `Would exceed total size limit (${MAX_TOTAL_CHARS} chars). Shorten value or remove entries.`;
    }
    return null;
  }

  setEntry(key: string, value: string, persistent?: boolean): string | null {
    const error = this.validateEntry(key, value);
    if (error) return error;
    const existing = this.entries.get(key);
    const entry = { key, value, updatedAt: Date.now(), persistent: persistent ?? existing?.persistent };
    if (this.storage && (persistent !== undefined || entry.persistent || existing?.persistent)) {
      updatePersistentEntries(this.storage, [key], entry.persistent ? [entry] : []);
    }
    this.entries.set(key, entry);
    return null;
  }

  /** Restore as much as fits locally, without rewriting or dropping the remaining durable entries. */
  loadEntries(entries: readonly WorkingMemoryEntry[]): number {
    let loaded = 0;
    for (const entry of entries) {
      if (this.validateEntry(entry.key, entry.value)) continue;
      this.entries.set(entry.key, { ...entry });
      loaded++;
    }
    return loaded;
  }

  getPersistentEntries(): WorkingMemoryEntry[] {
    return this.listEntries().filter((entry) => entry.persistent);
  }

  getEntry(key: string): WorkingMemoryEntry | undefined {
    return this.entries.get(key);
  }

  removeEntry(key: string): boolean {
    const entry = this.entries.get(key);
    if (entry?.persistent && this.storage) updatePersistentEntries(this.storage, [key]);
    return this.entries.delete(key);
  }

  listEntries(): WorkingMemoryEntry[] {
    return [...this.entries.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  }

  clearAll(): number {
    const persistent = this.getPersistentEntries();
    if (persistent.length > 0 && this.storage) {
      updatePersistentEntries(this.storage, persistent.map((entry) => entry.key));
    }
    const count = this.entries.size;
    this.entries.clear();
    return count;
  }

  /** Session teardown releases local entries, never durable entries. */
  dispose(): void {
    this.entries.clear();
  }

  setCompactionEnabled(enabled: boolean): void {
    this.compactionEnabled = enabled;
  }

  private totalChars(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.key.length + entry.value.length;
    return total;
  }

  private underPressure(): boolean {
    return this.entries.size >= COMPACT_ENTRY_THRESHOLD || this.totalChars() >= COMPACT_CHAR_THRESHOLD;
  }

  private compactIfNeeded(): number {
    if (!this.compactionEnabled || !this.underPressure()) return 0;
    const candidates = this.listEntries().filter((entry) => !entry.persistent && entry.value.length > COMPACT_TRUNCATE_LENGTH + 1);
    let compacted = 0;
    for (const entry of candidates) {
      this.entries.set(entry.key, { ...entry, value: `${entry.value.slice(0, COMPACT_TRUNCATE_LENGTH)}…` });
      compacted++;
      if (!this.underPressure()) break;
    }
    return compacted;
  }

  getWorkingMemoryState(): string {
    const compacted = this.compactIfNeeded();
    const entries = this.listEntries();
    let result = "";
    if (entries.length > 0) {
      const lines = entries.map((entry) => `- **${entry.key}**: ${entry.value}${entry.persistent ? " ★" : ""}`);
      result = `\n\n<working-memory>\n${lines.join("\n")}\n</working-memory>`;
    }
    if (compacted > 0) {
      result += `\n\n<working-memory-compacted>${compacted} entr${compacted === 1 ? "y was" : "ies were"} automatically truncated to reduce working memory pressure.</working-memory-compacted>`;
    }
    return result;
  }
}
