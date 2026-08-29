import type { Task } from "./task-store-types.js";

/**
 * Normalized in-memory representation and query owner for task collections.
 *
 * Owns all list, get, active, count, empty, and active-summary query
 * projections across local stores and remote provider adapters.
 */
export class TaskCollection {
  private tasks: Task[];

  constructor(initialTasks: readonly Task[] = []) {
    this.tasks = [...initialTasks];
  }

  /** Return all tasks in the collection. */
  list(): Task[] {
    return [...this.tasks];
  }

  /** Return only active (non-done) tasks. */
  active(): Task[] {
    return this.tasks.filter((t) => t.status !== "done");
  }

  /** Look up a task by numeric id. */
  get(id: number): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  /** Return true when the collection has zero tasks. */
  isEmpty(): boolean {
    return this.tasks.length === 0;
  }

  /** Total count of tasks in the collection. */
  count(): number {
    return this.tasks.length;
  }

  /** Summary of active tasks for session warmup and context. */
  getActiveSummary(): string | null {
    const active = this.tasks.filter((t) => t.status !== "done");
    if (active.length === 0) return null;
    const inProgress = active.filter((t) => t.status === "in_progress");
    const pending = active.filter((t) => t.status === "pending");
    const parts: string[] = [];
    if (inProgress.length > 0) {
      parts.push(
        `${inProgress.length} in progress: ${inProgress.map((t) => `"${t.task}"`).join(", ")}`,
      );
    }
    if (pending.length > 0) {
      const preview = pending.slice(0, 3).map((t) => `"${t.task}"`).join(", ");
      const more = pending.length > 3 ? ` (+${pending.length - 3} more)` : "";
      parts.push(`${pending.length} pending: ${preview}${more}`);
    }
    return parts.join("; ");
  }

  /** Replace the entire collection content. */
  replace(tasks: readonly Task[]): void {
    this.tasks = [...tasks];
  }

  /** Append a new task to the collection. */
  add(task: Task): void {
    this.tasks.push(task);
  }

  /** Update an existing task in the collection. Throws when not found. */
  update(id: number, changes: Partial<Task>): Task {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`Task #${id} not found`);
    if (changes.task !== undefined) task.task = changes.task;
    if (changes.status !== undefined) {
      task.status = changes.status;
      if (changes.status === "done") {
        task.completed = changes.completed ?? new Date().toISOString();
      }
    }
    if (changes.priority !== undefined) task.priority = changes.priority;
    if (changes.blocked_by !== undefined) {
      task.blocked_by = changes.blocked_by.length > 0 ? changes.blocked_by : undefined;
    }
    if (changes.parent_id !== undefined) task.parent_id = changes.parent_id;
    if (changes.notes !== undefined) task.notes = changes.notes;
    return task;
  }

  /** Remove a task by id. Returns true if removed, false if not found. */
  remove(id: number): boolean {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    this.tasks.splice(idx, 1);
    return true;
  }

  /** Remove all tasks from the collection. */
  clear(): void {
    this.tasks = [];
  }

  /** Remove completed tasks and return the number of removed tasks. */
  archiveCompleted(): number {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.status !== "done");
    return before - this.tasks.length;
  }
}
