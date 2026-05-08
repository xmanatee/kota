import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { projectHash } from "./schedule-parser.js";
import type { Task, TaskFileData, TaskPriority, TaskStatus } from "./task-store-types.js";

export type { Task, TaskPriority, TaskStatus } from "./task-store-types.js";

const MAX_COMPLETED = 15;

export class TaskStore {
  private tasks: Task[] = [];
  private nextId = 1;
  private filePath: string | null;
  private project: string;
  private loaded = false;
  private pbus: ProjectScopedEventBus | null;

  constructor(
    projectDir?: string,
    storageDir?: string | null,
    pbus?: ProjectScopedEventBus | null,
  ) {
    this.project = projectDir || process.cwd();
    this.pbus = pbus ?? null;
    if (storageDir === null) {
      // In-memory mode (no persistence)
      this.filePath = null;
      this.loaded = true;
    } else {
      // Defer dir creation to persist() so constructing a TaskStore — for
      // example as part of the per-project runtime bundle — does not touch
      // the filesystem until the project actually writes a task.
      const baseDir = storageDir || join(homedir(), ".kota");
      const hash = projectHash(this.project);
      this.filePath = join(baseDir, `tasks-${hash}.json`);
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.filePath) return;
    const data = this.tryReadFile(this.filePath) ?? this.tryReadFile(`${this.filePath}.tmp`);
    if (!data) return;
    if (data.project === this.project) {
      this.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      this.nextId = this.deriveNextId(data.nextId, this.tasks);
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
    const pending = this.tasks.filter(t => t.status === "pending").length;
    const in_progress = this.tasks.filter(t => t.status === "in_progress").length;
    const done = this.tasks.filter(t => t.status === "done").length;
    this.pbus.emit("task.changed", { counts: { pending, in_progress, done } });
  }

  private persist(): void {
    if (!this.filePath) return;
    // Prune old completed tasks
    const completed = this.tasks.filter(t => t.status === "done");
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
        for (const t of this.tasks) {
          if (t.parent_id !== undefined && removeIds.has(t.parent_id) && !removeIds.has(t.id)) {
            removeIds.add(t.id);
            changed = true;
          }
        }
      }
      this.tasks = this.tasks.filter(t => !removeIds.has(t.id));
    }
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data: TaskFileData = {
      project: this.project,
      tasks: this.tasks,
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
    if (opts?.parent_id !== undefined && !this.tasks.find(t => t.id === opts.parent_id)) {
      throw new Error(`parent task #${opts.parent_id} not found`);
    }
    if (opts?.blocked_by) {
      for (const depId of opts.blocked_by) {
        if (!this.tasks.find(t => t.id === depId)) {
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
    this.tasks.push(item);
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
    const item = this.tasks.find(t => t.id === id);
    if (!item) throw new Error(`Task #${id} not found`);
    if (changes.blocked_by) {
      for (const depId of changes.blocked_by) {
        if (!this.tasks.find(t => t.id === depId))
          throw new Error(`Dependency task #${depId} not found`);
        if (depId === id)
          throw new Error(`Task #${id} cannot depend on itself`);
      }
      item.blocked_by = changes.blocked_by.length > 0 ? changes.blocked_by : undefined;
    }
    if (changes.status) {
      if (changes.status === "in_progress" && item.blocked_by) {
        const pending = item.blocked_by.filter(d => {
          const dep = this.tasks.find(t => t.id === d);
          return dep && dep.status !== "done";
        });
        if (pending.length > 0)
          throw new Error(`task #${id} is blocked by incomplete tasks: #${pending.join(", #")}`);
      }
      item.status = changes.status;
      if (changes.status === "done") item.completed = new Date().toISOString();
    }
    if (changes.priority) item.priority = changes.priority;
    if (changes.notes !== undefined) item.notes = changes.notes;
    this.persist();
    this.emitChanged();
    return item;
  }

  list(): Task[] {
    this.ensureLoaded();
    return [...this.tasks];
  }

  active(): Task[] {
    this.ensureLoaded();
    return this.tasks.filter(t => t.status !== "done");
  }

  get(id: number): Task | undefined {
    this.ensureLoaded();
    return this.tasks.find(t => t.id === id);
  }

  clear(): void {
    this.tasks = [];
    this.nextId = 1;
    this.loaded = true;
    if (this.filePath && existsSync(this.filePath)) {
      const data: TaskFileData = { project: this.project, tasks: [], nextId: 1 };
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    }
    this.emitChanged();
  }

  archiveCompleted(): number {
    this.ensureLoaded();
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(t => t.status !== "done");
    const removed = before - this.tasks.length;
    if (removed > 0) {
      this.persist();
      this.emitChanged();
    }
    return removed;
  }

  /** Summary of active tasks for session warmup. */
  getActiveSummary(): string | null {
    this.ensureLoaded();
    const active = this.tasks.filter(t => t.status !== "done");
    if (active.length === 0) return null;
    const inProgress = active.filter(t => t.status === "in_progress");
    const pending = active.filter(t => t.status === "pending");
    const parts: string[] = [];
    if (inProgress.length > 0) {
      parts.push(
        `${inProgress.length} in progress: ${inProgress.map(t => `"${t.task}"`).join(", ")}`,
      );
    }
    if (pending.length > 0) {
      const preview = pending.slice(0, 3).map(t => `"${t.task}"`).join(", ");
      const more = pending.length > 3 ? ` (+${pending.length - 3} more)` : "";
      parts.push(`${pending.length} pending: ${preview}${more}`);
    }
    return parts.join("; ");
  }

  /** Whether the store has any tasks at all. */
  isEmpty(): boolean {
    this.ensureLoaded();
    return this.tasks.length === 0;
  }

  /** Count of all tasks. */
  count(): number {
    this.ensureLoaded();
    return this.tasks.length;
  }
}

// --- Singleton management ---

let store: TaskStore | undefined;

/** Initialize the task store for a specific project. Call once at session start. */
export function initTaskStore(projectDir?: string, storageDir?: string | null): void {
  store = new TaskStore(projectDir, storageDir);
}

/**
 * Install a pre-built {@link TaskStore} as the module-level singleton.
 * Used by the per-project runtime bundle factory to register the default
 * project's instance without re-binding `projectDir` outside the bundle.
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
