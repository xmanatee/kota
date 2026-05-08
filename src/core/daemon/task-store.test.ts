import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { projectHash } from "./schedule-parser.js";
import { getTaskStore, initTaskStore, resetTaskStore, TaskStore } from "./task-store.js";

const testDir = mkdtempSync(join(tmpdir(), "kota-task-test-"));

afterAll(() => {
  resetTaskStore();
  rmSync(testDir, { recursive: true, force: true });
});

describe("TaskStore", () => {
  let store: TaskStore;

  beforeEach(() => {
    store = new TaskStore("/test/project", testDir);
    store.clear();
  });

  describe("add", () => {
    it("creates a task with auto-incrementing ID", () => {
      const t1 = store.add("First task");
      const t2 = store.add("Second task");
      expect(t1.id).toBe(1);
      expect(t2.id).toBe(2);
      expect(t1.status).toBe("pending");
      expect(t1.created).toBeTruthy();
    });

    it("supports priority and parent_id", () => {
      store.add("Parent");
      const child = store.add("Child", { parent_id: 1, priority: "high" });
      expect(child.parent_id).toBe(1);
      expect(child.priority).toBe("high");
    });

    it("supports blocked_by", () => {
      store.add("Step 1");
      const t2 = store.add("Step 2", { blocked_by: [1] });
      expect(t2.blocked_by).toEqual([1]);
    });

    it("supports notes", () => {
      const t = store.add("Research", { notes: "Check 3 sources" });
      expect(t.notes).toBe("Check 3 sources");
    });

    it("throws on invalid parent_id", () => {
      expect(() => store.add("Orphan", { parent_id: 99 })).toThrow("parent task #99 not found");
    });

    it("throws on invalid blocked_by", () => {
      expect(() => store.add("Task", { blocked_by: [99] })).toThrow("dependency task #99 not found");
    });
  });

  describe("update", () => {
    it("updates status", () => {
      store.add("Task");
      const updated = store.update(1, { status: "in_progress" });
      expect(updated.status).toBe("in_progress");
    });

    it("sets completed timestamp when marked done", () => {
      store.add("Task");
      const updated = store.update(1, { status: "done" });
      expect(updated.completed).toBeTruthy();
    });

    it("updates notes", () => {
      store.add("Task");
      const updated = store.update(1, { notes: "Found something" });
      expect(updated.notes).toBe("Found something");
    });

    it("prevents starting blocked task", () => {
      store.add("Dep");
      store.add("Blocked", { blocked_by: [1] });
      expect(() => store.update(2, { status: "in_progress" })).toThrow("blocked by incomplete");
    });

    it("allows starting after dependency completes", () => {
      store.add("Dep");
      store.add("Blocked", { blocked_by: [1] });
      store.update(1, { status: "done" });
      const updated = store.update(2, { status: "in_progress" });
      expect(updated.status).toBe("in_progress");
    });

    it("prevents self-dependency", () => {
      store.add("Task");
      expect(() => store.update(1, { blocked_by: [1] })).toThrow("cannot depend on itself");
    });

    it("throws for non-existent task", () => {
      expect(() => store.update(99, { status: "done" })).toThrow("Task #99 not found");
    });
  });

  describe("persistence", () => {
    it("saves and loads tasks across instances", () => {
      store.add("Persistent task", { priority: "high" });
      store.add("Another task");
      store.update(1, { status: "in_progress" });

      // Create new store for same project
      const store2 = new TaskStore("/test/project", testDir);
      const tasks = store2.list();
      expect(tasks).toHaveLength(2);
      expect(tasks[0].task).toBe("Persistent task");
      expect(tasks[0].status).toBe("in_progress");
      expect(tasks[0].priority).toBe("high");
      expect(tasks[1].task).toBe("Another task");
    });

    it("IDs continue from previous session", () => {
      store.add("Task 1");
      store.add("Task 2");

      const store2 = new TaskStore("/test/project", testDir);
      const t3 = store2.add("Task 3");
      expect(t3.id).toBe(3);
    });

    it("isolates projects by path", () => {
      store.add("Project A task");

      const storeB = new TaskStore("/other/project", testDir);
      expect(storeB.list()).toHaveLength(0);
      storeB.add("Project B task");

      // Original store still has its tasks
      const storeA = new TaskStore("/test/project", testDir);
      expect(storeA.list()).toHaveLength(1);
      expect(storeA.list()[0].task).toBe("Project A task");

      storeB.clear();
    });

    it("clear removes the persisted tasks", () => {
      store.add("Temp task");
      store.clear();

      const store2 = new TaskStore("/test/project", testDir);
      expect(store2.list()).toHaveLength(0);
    });

    it("notes persist across sessions", () => {
      store.add("Research topic", { notes: "Started with sources A, B" });
      store.update(1, { notes: "Found 5 sources, comparing" });

      const store2 = new TaskStore("/test/project", testDir);
      const task = store2.get(1);
      expect(task?.notes).toBe("Found 5 sources, comparing");
    });
  });

  describe("auto-pruning", () => {
    it("keeps MAX_COMPLETED most recent completed tasks", () => {
      // Add and complete 20 tasks
      for (let i = 0; i < 20; i++) {
        store.add(`Task ${i}`);
        store.update(i + 1, { status: "done" });
      }
      // Add one more active task
      store.add("Active task");

      const tasks = store.list();
      const completed = tasks.filter(t => t.status === "done");
      expect(completed.length).toBeLessThanOrEqual(15);
      expect(tasks.find(t => t.task === "Active task")).toBeTruthy();
    });
  });

  describe("archiveCompleted", () => {
    it("removes completed tasks and returns count", () => {
      store.add("Active");
      store.add("Done 1");
      store.add("Done 2");
      store.update(2, { status: "done" });
      store.update(3, { status: "done" });

      const count = store.archiveCompleted();
      expect(count).toBe(2);
      expect(store.list()).toHaveLength(1);
      expect(store.list()[0].task).toBe("Active");
    });

    it("returns 0 when nothing to archive", () => {
      store.add("Active");
      expect(store.archiveCompleted()).toBe(0);
    });
  });

  describe("getActiveSummary", () => {
    it("returns null when no active tasks", () => {
      expect(store.getActiveSummary()).toBeNull();
    });

    it("returns null when only completed tasks", () => {
      store.add("Done");
      store.update(1, { status: "done" });
      expect(store.getActiveSummary()).toBeNull();
    });

    it("summarizes in-progress and pending tasks", () => {
      store.add("Research competitors");
      store.add("Write report");
      store.update(1, { status: "in_progress" });

      const summary = store.getActiveSummary();
      expect(summary).toContain('1 in progress: "Research competitors"');
      expect(summary).toContain('1 pending: "Write report"');
    });

    it("truncates long pending lists", () => {
      for (let i = 0; i < 5; i++) {
        store.add(`Task ${i}`);
      }
      const summary = store.getActiveSummary()!;
      expect(summary).toContain("(+2 more)");
    });
  });

  describe("in-memory mode", () => {
    it("works without persistence when storageDir is null", () => {
      const memStore = new TaskStore("/test", null);
      memStore.add("In-memory task");
      expect(memStore.list()).toHaveLength(1);
      memStore.clear();
      expect(memStore.list()).toHaveLength(0);
    });
  });

  describe("error paths", () => {
    function filePath(dir: string, proj: string): string {
      return join(dir, `tasks-${projectHash(proj)}.json`);
    }

    it("recovers gracefully from corrupt JSON file", () => {
      store.add("Valid task");
      writeFileSync(filePath(testDir, "/test/project"), "not json{{{");
      const store2 = new TaskStore("/test/project", testDir);
      expect(store2.list()).toHaveLength(0);
    });

    it("recovers gracefully from truncated JSON file", () => {
      store.add("Valid task");
      writeFileSync(filePath(testDir, "/test/project"), '{"project":');
      const store2 = new TaskStore("/test/project", testDir);
      expect(store2.list()).toHaveLength(0);
    });

    it("handles tasks field that is not an array", () => {
      writeFileSync(
        filePath(testDir, "/test/project"),
        JSON.stringify({ project: "/test/project", tasks: "not-array", nextId: 1 }),
      );
      const store2 = new TaskStore("/test/project", testDir);
      expect(store2.list()).toHaveLength(0);
      // Should still be able to add tasks
      const t = store2.add("New task");
      expect(t.id).toBe(1);
    });

    it("handles tasks field that is null", () => {
      writeFileSync(
        filePath(testDir, "/test/project"),
        JSON.stringify({ project: "/test/project", tasks: null, nextId: 3 }),
      );
      const store2 = new TaskStore("/test/project", testDir);
      expect(store2.list()).toHaveLength(0);
    });

    it("derives nextId from max task ID when saved nextId is zero", () => {
      writeFileSync(
        filePath(testDir, "/test/project"),
        JSON.stringify({
          project: "/test/project",
          tasks: [{ id: 5, task: "Existing", status: "pending", created: "2025-01-01" }],
          nextId: 0,
        }),
      );
      const store2 = new TaskStore("/test/project", testDir);
      const t = store2.add("New task");
      // Should be max(5) + 1, not 0+1=1 (which would collide)
      expect(t.id).toBe(6);
    });

    it("derives nextId from max task ID when saved nextId is NaN", () => {
      writeFileSync(
        filePath(testDir, "/test/project"),
        JSON.stringify({
          project: "/test/project",
          tasks: [{ id: 3, task: "Existing", status: "pending", created: "2025-01-01" }],
          nextId: "bad",
        }),
      );
      const store2 = new TaskStore("/test/project", testDir);
      const t = store2.add("New task");
      expect(t.id).toBe(4);
    });

    it("derives nextId from max task ID when saved nextId is negative", () => {
      writeFileSync(
        filePath(testDir, "/test/project"),
        JSON.stringify({
          project: "/test/project",
          tasks: [{ id: 2, task: "Existing", status: "pending", created: "2025-01-01" }],
          nextId: -5,
        }),
      );
      const store2 = new TaskStore("/test/project", testDir);
      const t = store2.add("New task");
      expect(t.id).toBe(3);
    });

    it("persist uses atomic write (no .tmp file left behind)", () => {
      store.add("Task 1");
      const fp = filePath(testDir, "/test/project");
      expect(existsSync(fp)).toBe(true);
      expect(existsSync(`${fp}.tmp`)).toBe(false);
    });

    it("recovers from .tmp backup when main file is corrupt", () => {
      store.add("Important task");
      const fp = filePath(testDir, "/test/project");
      const goodContent = readFileSync(fp, "utf-8");
      // Simulate crash: main file corrupt, .tmp has good data
      writeFileSync(fp, "corrupt{{{");
      writeFileSync(`${fp}.tmp`, goodContent);
      const store2 = new TaskStore("/test/project", testDir);
      expect(store2.list()).toHaveLength(1);
      expect(store2.list()[0].task).toBe("Important task");
    });

    it("throws clear error on permission denied (not silent empty)", () => {
      store.add("Task");
      const fp = filePath(testDir, "/test/project");
      try {
        chmodSync(fp, 0o000);
        const store2 = new TaskStore("/test/project", testDir);
        // Should throw, not silently return empty
        expect(() => store2.list()).toThrow();
      } finally {
        chmodSync(fp, 0o644);
      }
    });

    it("handles empty file gracefully", () => {
      writeFileSync(filePath(testDir, "/test/project"), "");
      const store2 = new TaskStore("/test/project", testDir);
      expect(store2.list()).toHaveLength(0);
    });

    it("handles file with only whitespace", () => {
      writeFileSync(filePath(testDir, "/test/project"), "   \n  ");
      const store2 = new TaskStore("/test/project", testDir);
      expect(store2.list()).toHaveLength(0);
    });
  });
});

describe("singleton management", () => {
  beforeEach(() => {
    resetTaskStore();
  });

  afterAll(() => {
    resetTaskStore();
  });

  it("getTaskStore returns in-memory store by default", () => {
    const store = getTaskStore();
    store.add("Test");
    expect(store.list()).toHaveLength(1);
    store.clear();
  });

  it("initTaskStore creates persistent store", () => {
    const dir = mkdtempSync(join(tmpdir(), "kota-singleton-test-"));
    initTaskStore("/test/project", dir);
    const store = getTaskStore();
    store.add("Persistent");
    expect(existsSync(join(dir, `tasks-${hashProject("/test/project")}.json`))).toBe(true);
    store.clear();
    rmSync(dir, { recursive: true, force: true });
  });

  it("resetTaskStore clears singleton", () => {
    const store = getTaskStore();
    store.add("Before reset");
    resetTaskStore();
    const store2 = getTaskStore();
    expect(store2.list()).toHaveLength(0);
  });
});

describe("task.changed events", () => {
  let store: TaskStore;
  let bus: EventBus;
  let received: Array<{ event: string; payload: Record<string, unknown> }>;

  beforeEach(() => {
    bus = new EventBus();
    received = [];
    bus.on("*", (envelope) => {
      received.push({ event: envelope.type, payload: envelope.payload as Record<string, unknown> });
    });
    const pbus = new ProjectScopedEventBus(bus, "test-project");
    store = new TaskStore("/test/project", null, pbus);
  });

  it("emits task.changed on add with current counts", () => {
    store.add("Task 1");
    const calls = received.filter(({ event }) => event === "task.changed");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toEqual({ projectId: "test-project", counts: { pending: 1, in_progress: 0, done: 0 } });
  });

  it("emits task.changed on update with updated counts", () => {
    store.add("Task 1");
    received.length = 0;
    store.update(1, { status: "in_progress" });
    const calls = received.filter(({ event }) => event === "task.changed");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toEqual({ projectId: "test-project", counts: { pending: 0, in_progress: 1, done: 0 } });
  });

  it("emits task.changed on clear with zero counts", () => {
    store.add("Task 1");
    received.length = 0;
    store.clear();
    const calls = received.filter(({ event }) => event === "task.changed");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toEqual({ projectId: "test-project", counts: { pending: 0, in_progress: 0, done: 0 } });
  });

  it("emits task.changed on archiveCompleted when tasks are removed", () => {
    store.add("Task 1");
    store.update(1, { status: "done" });
    received.length = 0;
    store.archiveCompleted();
    const calls = received.filter(({ event }) => event === "task.changed");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toEqual({ projectId: "test-project", counts: { pending: 0, in_progress: 0, done: 0 } });
  });

  it("does not emit task.changed on archiveCompleted when nothing to archive", () => {
    store.add("Active");
    received.length = 0;
    store.archiveCompleted();
    const calls = received.filter(({ event }) => event === "task.changed");
    expect(calls).toHaveLength(0);
  });
});

// Helper to verify file naming
function hashProject(path: string): string {
  let h = 5381;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) + h + path.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}
