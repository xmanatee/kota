import { describe, expect, it } from "vitest";
import { TaskCollection } from "./task-collection.js";
import type { Task } from "./task-store-types.js";

function makeTask(id: number, task: string, status: Task["status"] = "pending", overrides?: Partial<Task>): Task {
  return {
    id,
    task,
    status,
    created: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("TaskCollection", () => {
  describe("construction and basic queries", () => {
    it("starts empty when constructed with no arguments", () => {
      const collection = new TaskCollection();
      expect(collection.isEmpty()).toBe(true);
      expect(collection.count()).toBe(0);
      expect(collection.list()).toEqual([]);
      expect(collection.active()).toEqual([]);
      expect(collection.getActiveSummary()).toBeNull();
    });

    it("initializes with provided tasks", () => {
      const t1 = makeTask(1, "Task 1");
      const t2 = makeTask(2, "Task 2", "done");
      const collection = new TaskCollection([t1, t2]);

      expect(collection.isEmpty()).toBe(false);
      expect(collection.count()).toBe(2);
      expect(collection.list()).toHaveLength(2);
      expect(collection.active()).toEqual([t1]);
    });

    it("list returns a shallow copy preventing external mutations", () => {
      const collection = new TaskCollection([makeTask(1, "Original")]);
      const list = collection.list();
      list.push(makeTask(2, "Injected"));
      expect(collection.count()).toBe(1);
    });
  });

  describe("get and find", () => {
    it("finds a task by numeric id", () => {
      const t1 = makeTask(10, "Task 10");
      const collection = new TaskCollection([t1]);
      expect(collection.get(10)).toBe(t1);
      expect(collection.get(99)).toBeUndefined();
    });
  });

  describe("replace and add", () => {
    it("replaces all tasks", () => {
      const collection = new TaskCollection([makeTask(1, "Old")]);
      collection.replace([makeTask(2, "New 1"), makeTask(3, "New 2")]);
      expect(collection.count()).toBe(2);
      expect(collection.get(1)).toBeUndefined();
      expect(collection.get(2)).toBeDefined();
    });

    it("adds individual tasks", () => {
      const collection = new TaskCollection();
      collection.add(makeTask(1, "Added"));
      expect(collection.count()).toBe(1);
      expect(collection.get(1)?.task).toBe("Added");
    });
  });

  describe("update and remove", () => {
    it("updates existing task fields and returns the task", () => {
      const collection = new TaskCollection([makeTask(1, "Initial")]);
      const updated = collection.update(1, { task: "Renamed", priority: "high", notes: "Note" });
      expect(updated.task).toBe("Renamed");
      expect(updated.priority).toBe("high");
      expect(updated.notes).toBe("Note");
    });

    it("sets completed timestamp when status changes to done", () => {
      const collection = new TaskCollection([makeTask(1, "In progress", "in_progress")]);
      const updated = collection.update(1, { status: "done" });
      expect(updated.status).toBe("done");
      expect(updated.completed).toBeDefined();
    });

    it("throws when updating non-existent task", () => {
      const collection = new TaskCollection();
      expect(() => collection.update(99, { status: "done" })).toThrow("Task #99 not found");
    });

    it("removes a task by id", () => {
      const collection = new TaskCollection([makeTask(1, "T1"), makeTask(2, "T2")]);
      expect(collection.remove(1)).toBe(true);
      expect(collection.count()).toBe(1);
      expect(collection.remove(1)).toBe(false);
    });
  });

  describe("clear and archiveCompleted", () => {
    it("clear empties the collection", () => {
      const collection = new TaskCollection([makeTask(1, "T1"), makeTask(2, "T2")]);
      collection.clear();
      expect(collection.isEmpty()).toBe(true);
    });

    it("archiveCompleted removes done tasks and returns count", () => {
      const collection = new TaskCollection([
        makeTask(1, "Active"),
        makeTask(2, "Done 1", "done"),
        makeTask(3, "Done 2", "done"),
      ]);
      const count = collection.archiveCompleted();
      expect(count).toBe(2);
      expect(collection.count()).toBe(1);
      expect(collection.get(1)?.task).toBe("Active");
    });
  });

  describe("getActiveSummary", () => {
    it("returns null when no tasks or only done tasks", () => {
      expect(new TaskCollection().getActiveSummary()).toBeNull();
      expect(new TaskCollection([makeTask(1, "Done", "done")]).getActiveSummary()).toBeNull();
    });

    it("summarizes in-progress and pending tasks", () => {
      const collection = new TaskCollection([
        makeTask(1, "Working on this", "in_progress"),
        makeTask(2, "Queue item", "pending"),
      ]);
      const summary = collection.getActiveSummary();
      expect(summary).toContain('1 in progress: "Working on this"');
      expect(summary).toContain('1 pending: "Queue item"');
    });

    it("truncates pending preview beyond 3 items", () => {
      const collection = new TaskCollection([
        makeTask(1, "P1", "pending"),
        makeTask(2, "P2", "pending"),
        makeTask(3, "P3", "pending"),
        makeTask(4, "P4", "pending"),
        makeTask(5, "P5", "pending"),
      ]);
      const summary = collection.getActiveSummary()!;
      expect(summary).toContain('5 pending: "P1", "P2", "P3" (+2 more)');
    });
  });
});
