import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ScopedEventBus } from "#core/events/scope.js";
import { scopeHash } from "./schedule-parser.js";
import { TaskCollection } from "./task-collection.js";
import type { Task, TaskFileData, TaskPriority, TaskStatus } from "./task-store-types.js";

export { TaskCollection } from "./task-collection.js";
export type { Task, TaskPriority, TaskStatus } from "./task-store-types.js";

const MAX_COMPLETED = 15;

export class TaskStore {
  readonly collection = new TaskCollection();
  private nextId = 1;
  private filePath: string | null;
  private scope: string;
  private loaded = false;
  private pbus: ScopedEventBus | null;

  constructor(
    scopeRoot?: string,
    storageDir?: string | null,
    pbus?: ScopedEventBus | null,
  ) {
    this.scope = scopeRoot || process.cwd();
    this.pbus = pbus ?? null;
    if (storageDir === null) {
      // In-memory mode (no persistence)
      this.filePath = null;
      this.loaded = true;
    } else {
      // Defer dir creation to persist() so constructing a TaskStore — for
      // example as part of the per-scope runtime bundle — does not touch
      // the filesystem until the scope actually writes a task.
      const baseDir = storageDir || join(this.scope, ".kota");
      const hash = scopeHash(this.scope);
      this.filePath = join(baseDir, `tasks-${hash}.json`);
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.filePath) return;
    const data = this.tryReadFile(this.filePath) ?? this.tryReadFile(`${this.filePath}.tmp`);
    if (!data) return;
    if (data.scope === this.scope) {
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      this.collection.replace(tasks);
      this.nextId = this.deriveNextId(data.nextId, tasks);
    }
  }

  private tryReadFile(path: string): TaskFileData | null {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    try {
      return JSON.parse(raw) as TaskFileData;
    } catch {
      return null;
    }
  }

  private deriveNextId(saved: unknown, tasks: Task[]): number {
    if (typeof saved === "number" && saved > 0 && Number.isFinite(saved)) {
      return saved;
    }
    if (tasks.length === 0) return 1;
    const maxId = Math.max(...tasks.map(t => (typeof t.id === "number" ? t.id : 0)));
    return maxId + 1;
  }

  private emitChanged(): void {
    if (!this.pbus) return;
    const tasks = this.collection.list();
    const pending = tasks.filter(t => t.status === "pending").length;
    const in_progress = tasks.filter(t => t.status === "in_progress").length;
    const done = tasks.filter(t => t.status === "done").length;
    this.pbus.emit("task.changed", { counts: { pending, in_progress, done } });
  }

  private persist(): void {
    if (!this.filePath) return;
    // Prune old completed tasks
    const tasks = this.collection.list();
    const completed = tasks.filter(t => t.status === "done");
    if (completed.length > MAX_COMPLETED) {
      const sorted = [...completed].sort((a, b) =>
        (a.completed || a.created).localeCompare(b.completed || b.created),
      );
      const removeIds = new Set(
        sorted.slice(0, completed.length - MAX_COMPLETED).map(t => t.id),
      );
      // Also remove orphaned children of pruned tasks
      let changed = true;
      while (changed) {
        changed = false;
        for (const t of tasks) {
          if (t.parent_id !== undefined && removeIds.has(t.parent_id) && !removeIds.has(t.id)) {
            removeIds.add(t.id);
            changed = true;
          }
        }
      }
      this.collection.replace(tasks.filter(t => !removeIds.has(t.id)));
    }
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data: TaskFileData = {
      scope: this.scope,
      tasks: this.collection.list(),
      nextId: this.nextId,
    };
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmpPath, this.filePath);
  }

  add(
    taskText: string,
    opts?: {
      parent_id?: number;
      priority?: TaskPriority;
      blocked_by?: number[];
      notes?: string;
    },
  ): Task {
    this.ensureLoaded();
    if (opts?.parent_id !== undefined && !this.collection.get(opts.parent_id)) {
      throw new Error(`parent task #${opts.parent_id} not found`);
    }
    if (opts?.blocked_by) {
      for (const depId of opts.blocked_by) {
        if (!this.collection.get(depId)) {
          throw new Error(`dependency task #${depId} not found`);
        }
      }
    }
    const item: Task = {
      id: this.nextId++,
      task: taskText,
      status: "pending",
      created: new Date().toISOString(),
    };
    if (opts?.parent_id !== undefined) item.parent_id = opts.parent_id;
    if (opts?.priority) item.priority = opts.priority;
    if (opts?.blocked_by?.length) item.blocked_by = opts.blocked_by;
    if (opts?.notes) item.notes = opts.notes;
    this.collection.add(item);
    this.persist();
    this.emitChanged();
    return item;
  }

  update(
    id: number,
    changes: {
      status?: TaskStatus;
      priority?: TaskPriority;
      blocked_by?: number[];
      notes?: string;
    },
  ): Task {
    this.ensureLoaded();
    const item = this.collection.get(id);
    if (!item) throw new Error(`Task #${id} not found`);
    if (changes.blocked_by) {
      for (const depId of changes.blocked_by) {
        if (!this.collection.get(depId))
          throw new Error(`Dependency task #${depId} not found`);
        if (depId === id)
          throw new Error(`Task #${id} cannot depend on itself`);
      }
    }
    if (changes.status) {
      if (changes.status === "in_progress") {
        const blockedBy = changes.blocked_by ?? item.blocked_by;
        if (blockedBy) {
          const pending = blockedBy.filter(d => {
            const dep = this.collection.get(d);
            return dep && dep.status !== "done";
          });
          if (pending.length > 0)
            throw new Error(`task #${id} is blocked by incomplete tasks: #${pending.join(", #")}`);
        }
      }
    }
    const updated = this.collection.update(id, changes);
    this.persist();
    this.emitChanged();
    return updated;
  }

  list(): Task[] {
    this.ensureLoaded();
    return this.collection.list();
  }

  active(): Task[] {
    this.ensureLoaded();
    return this.collection.active();
  }

  get(id: number): Task | undefined {
    this.ensureLoaded();
    return this.collection.get(id);
  }

  clear(): void {
    this.collection.clear();
    this.nextId = 1;
    this.loaded = true;
    if (this.filePath && existsSync(this.filePath)) {
      const data: TaskFileData = { scope: this.scope, tasks: [], nextId: 1 };
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    }
    this.emitChanged();
  }

  archiveCompleted(): number {
    this.ensureLoaded();
    const removed = this.collection.archiveCompleted();
    if (removed > 0) {
      this.persist();
      this.emitChanged();
    }
    return removed;
  }

  /** Summary of active tasks for session warmup. */
  getActiveSummary(): string | null {
    this.ensureLoaded();
    return this.collection.getActiveSummary();
  }

  /** Whether the store has any tasks at all. */
  isEmpty(): boolean {
    this.ensureLoaded();
    return this.collection.isEmpty();
  }

  /** Count of all tasks. */
  count(): number {
    this.ensureLoaded();
    return this.collection.count();
  }
}

// --- Singleton management ---

let store: TaskStore | undefined;

/** Initialize the task store for a specific scope. Call once at session start. */
export function initTaskStore(scopeRoot?: string, storageDir?: string | null): void {
  store = new TaskStore(scopeRoot, storageDir);
}

/**
 * Install a pre-built {@link TaskStore} as the module-level singleton.
 * Used by the per-scope runtime bundle factory to register the default
 * scope's instance without re-binding `scopeRoot` outside the bundle.
 */
export function setTaskStoreInstance(instance: TaskStore): void {
  store = instance;
}

/** Get the singleton task store. Auto-creates in-memory if not initialized. */
export function getTaskStore(): TaskStore {
  if (!store) store = new TaskStore(undefined, null);
  return store;
}

/** Reset the singleton (for tests). */
export function resetTaskStore(): void {
  store = undefined;
}
