import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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

// Helper to verify file naming
function hashProject(path: string): string {
  let h = 5381;
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) + h + path.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}
