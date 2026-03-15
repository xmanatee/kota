import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus = "pending" | "in_progress" | "done";

export type Task = {
  id: number;
  task: string;
  status: TaskStatus;
  parent_id?: number;
  priority?: TaskPriority;
  blocked_by?: number[];
  created: string;
  completed?: string;
  notes?: string;
};

type TaskFileData = {
  project: string;
  tasks: Task[];
  nextId: number;
};

const MAX_COMPLETED = 15;

function projectHash(path: string): string {
  let h = 5381;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) + h + path.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

export class TaskStore {
  private tasks: Task[] = [];
  private nextId = 1;
  private filePath: string | null;
  private project: string;
  private loaded = false;

  constructor(projectDir?: string, storageDir?: string | null) {
    this.project = projectDir || process.cwd();
    if (storageDir === null) {
      // In-memory mode (no persistence)
      this.filePath = null;
      this.loaded = true;
    } else {
      const baseDir = storageDir || join(homedir(), ".kota");
      if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
      const hash = projectHash(this.project);
      this.filePath = join(baseDir, `tasks-${hash}.json`);
    }
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const data: TaskFileData = JSON.parse(raw);
      if (data.project === this.project) {
        this.tasks = data.tasks || [];
        this.nextId = data.nextId || 1;
      }
    } catch {
      this.tasks = [];
    }
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
    const dir = this.filePath.replace(/\/[^/]+$/, "");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data: TaskFileData = {
      project: this.project,
      tasks: this.tasks,
      nextId: this.nextId,
    };
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
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
  }

  archiveCompleted(): number {
    this.ensureLoaded();
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(t => t.status !== "done");
    if (this.tasks.length < before) this.persist();
    return before - this.tasks.length;
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

/** Get the singleton task store. Auto-creates in-memory if not initialized. */
export function getTaskStore(): TaskStore {
  if (!store) store = new TaskStore(undefined, null);
  return store;
}

/** Reset the singleton (for tests). */
export function resetTaskStore(): void {
  store = undefined;
}
