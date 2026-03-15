import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { runTodo, getTodoState } from "./todo.js";
import { initTaskStore, resetTaskStore } from "../task-store.js";

beforeAll(() => {
  initTaskStore(process.cwd(), null); // in-memory mode for tests
});

afterAll(() => {
  resetTaskStore();
});

describe("runTodo", () => {
  beforeEach(async () => {
    await runTodo({ action: "clear" });
  });

  describe("add", () => {
    it("adds a task and returns confirmation", async () => {
      const result = await runTodo({ action: "add", task: "Write tests" });
      expect(result.content).toContain("Added task #");
      expect(result.content).toContain("Write tests");
      expect(result.is_error).toBeUndefined();
    });

    it("auto-increments IDs", async () => {
      const r1 = await runTodo({ action: "add", task: "First" });
      const r2 = await runTodo({ action: "add", task: "Second" });
      expect(r1.content).toContain("#1");
      expect(r2.content).toContain("#2");
    });

    it("returns error when task is missing", async () => {
      const result = await runTodo({ action: "add" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("task is required");
    });
  });

  describe("update", () => {
    it("updates task status", async () => {
      await runTodo({ action: "add", task: "Do thing" });
      const result = await runTodo({ action: "update", id: 1, status: "done" });
      expect(result.content).toContain("Updated task #1");
      expect(result.content).toContain("status: done");
      expect(result.is_error).toBeUndefined();
    });

    it("returns error when id is missing", async () => {
      const result = await runTodo({ action: "update", status: "done" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("id is required");
    });

    it("returns error when no fields provided", async () => {
      await runTodo({ action: "add", task: "Task" });
      const result = await runTodo({ action: "update", id: 1 });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("status, priority, blocked_by, or notes required");
    });

    it("returns error for non-existent task", async () => {
      const result = await runTodo({ action: "update", id: 99, status: "done" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("not found");
    });
  });

  describe("list", () => {
    it("returns 'No tasks' when empty", async () => {
      const result = await runTodo({ action: "list" });
      expect(result.content).toBe("No tasks.");
    });

    it("formats tasks with status icons", async () => {
      await runTodo({ action: "add", task: "Pending task" });
      await runTodo({ action: "add", task: "Active task" });
      await runTodo({ action: "add", task: "Done task" });
      await runTodo({ action: "update", id: 2, status: "in_progress" });
      await runTodo({ action: "update", id: 3, status: "done" });

      const result = await runTodo({ action: "list" });
      expect(result.content).toContain("○ #1 [pending] Pending task");
      expect(result.content).toContain("→ #2 [in_progress] Active task");
      expect(result.content).toContain("✓ #3 [done] Done task");
    });
  });

  describe("clear", () => {
    it("removes all tasks", async () => {
      await runTodo({ action: "add", task: "Task 1" });
      await runTodo({ action: "add", task: "Task 2" });
      const result = await runTodo({ action: "clear" });
      expect(result.content).toBe("Cleared all tasks");

      const list = await runTodo({ action: "list" });
      expect(list.content).toBe("No tasks.");
    });

    it("resets ID counter", async () => {
      await runTodo({ action: "add", task: "Before clear" });
      await runTodo({ action: "clear" });
      const result = await runTodo({ action: "add", task: "After clear" });
      expect(result.content).toContain("#1");
    });
  });

  it("returns error for unknown action", async () => {
    const result = await runTodo({ action: "bogus" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("unknown action");
  });
});

describe("getTodoState", () => {
  beforeEach(async () => {
    await runTodo({ action: "clear" });
  });

  it("returns empty string when no tasks", () => {
    expect(getTodoState()).toBe("");
  });

  it("returns XML-wrapped task list when tasks exist", async () => {
    await runTodo({ action: "add", task: "Test task" });
    const state = getTodoState();
    expect(state).toContain("<current-tasks>");
    expect(state).toContain("</current-tasks>");
    expect(state).toContain("Test task");
  });

  it("reflects full lifecycle: add → in_progress → done → clear", async () => {
    // Add tasks (simulates agent planning a multi-step workflow)
    await runTodo({ action: "add", task: "Research bundler A" });
    await runTodo({ action: "add", task: "Research bundler B" });
    await runTodo({ action: "add", task: "Write comparison" });

    let state = getTodoState();
    expect(state).toContain("○ #1 [pending] Research bundler A");
    expect(state).toContain("○ #2 [pending] Research bundler B");
    expect(state).toContain("○ #3 [pending] Write comparison");

    // Mark first task in progress
    await runTodo({ action: "update", id: 1, status: "in_progress" });
    state = getTodoState();
    expect(state).toContain("→ #1 [in_progress] Research bundler A");
    expect(state).toContain("○ #2 [pending] Research bundler B");

    // Complete first, start second
    await runTodo({ action: "update", id: 1, status: "done" });
    await runTodo({ action: "update", id: 2, status: "in_progress" });
    state = getTodoState();
    expect(state).toContain("✓ #1 [done] Research bundler A");
    expect(state).toContain("→ #2 [in_progress] Research bundler B");

    // Clear resets everything
    await runTodo({ action: "clear" });
    expect(getTodoState()).toBe("");
  });

  it("is safe for system prompt concatenation", async () => {
    await runTodo({ action: "add", task: "Task with <xml> & special chars" });
    const state = getTodoState();
    // Starts with newline — safe to append to other dynamic state strings
    expect(state.startsWith("\n")).toBe(true);
    // Properly wrapped in XML tags
    expect(state).toMatch(/\n<current-tasks>\n[\s\S]+\n<\/current-tasks>/);
  });

  it("state updates are visible across module boundaries", async () => {
    // Simulates the cross-module path: tool execution (runTodo) updates state,
    // then loop.ts reads it via getTodoState() for the next system prompt
    const { runTodo: runTodoFresh, getTodoState: getTodoStateFresh } =
      await import("./todo.js");
    await runTodoFresh({ action: "clear" });

    // Both imports reference the same module singleton
    await runTodoFresh({ action: "add", task: "Cross-module task" });
    const state = getTodoStateFresh();
    expect(state).toContain("Cross-module task");
    expect(state).toContain("<current-tasks>");

    await runTodoFresh({ action: "clear" });
  });
});

describe("subtasks", () => {
  beforeEach(async () => {
    await runTodo({ action: "clear" });
  });

  it("adds subtask with parent_id", async () => {
    await runTodo({ action: "add", task: "Parent task" });
    const result = await runTodo({ action: "add", task: "Child task", parent_id: 1 });
    expect(result.content).toContain("Added task #2: Child task");
    expect(result.content).toContain("subtask of #1");
    expect(result.is_error).toBeUndefined();
  });

  it("rejects subtask with non-existent parent", async () => {
    const result = await runTodo({ action: "add", task: "Orphan", parent_id: 99 });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("parent task #99 not found");
  });

  it("displays subtasks indented under parents", async () => {
    await runTodo({ action: "add", task: "Phase 1" });
    await runTodo({ action: "add", task: "Task A", parent_id: 1 });
    await runTodo({ action: "add", task: "Task B", parent_id: 1 });
    await runTodo({ action: "add", task: "Phase 2" });

    const result = await runTodo({ action: "list" });
    const lines = (result.content as string).split("\n");
    expect(lines[0]).toBe("○ #1 [pending] Phase 1");
    expect(lines[1]).toBe("  ○ #2 [pending] Task A");
    expect(lines[2]).toBe("  ○ #3 [pending] Task B");
    expect(lines[3]).toBe("○ #4 [pending] Phase 2");
  });

  it("supports nested subtasks (grandchildren)", async () => {
    await runTodo({ action: "add", task: "Root" });
    await runTodo({ action: "add", task: "Child", parent_id: 1 });
    await runTodo({ action: "add", task: "Grandchild", parent_id: 2 });

    const result = await runTodo({ action: "list" });
    const lines = (result.content as string).split("\n");
    expect(lines[0]).toBe("○ #1 [pending] Root");
    expect(lines[1]).toBe("  ○ #2 [pending] Child");
    expect(lines[2]).toBe("    ○ #3 [pending] Grandchild");
  });

  it("subtasks reflect in getTodoState", async () => {
    await runTodo({ action: "add", task: "Main task" });
    await runTodo({ action: "add", task: "Sub task", parent_id: 1 });
    const state = getTodoState();
    expect(state).toContain("○ #1 [pending] Main task");
    expect(state).toContain("  ○ #2 [pending] Sub task");
    expect(state).toContain("<current-tasks>");
  });

  it("subtask status updates independently of parent", async () => {
    await runTodo({ action: "add", task: "Parent" });
    await runTodo({ action: "add", task: "Child", parent_id: 1 });
    await runTodo({ action: "update", id: 2, status: "done" });

    const result = await runTodo({ action: "list" });
    expect(result.content).toContain("○ #1 [pending] Parent");
    expect(result.content).toContain("  ✓ #2 [done] Child");
  });
});

describe("priority", () => {
  beforeEach(async () => {
    await runTodo({ action: "clear" });
  });

  it("adds task with priority", async () => {
    const result = await runTodo({ action: "add", task: "Urgent fix", priority: "high" });
    expect(result.content).toContain("priority: high");
    expect(result.is_error).toBeUndefined();
  });

  it("displays priority icon in listing", async () => {
    await runTodo({ action: "add", task: "High", priority: "high" });
    await runTodo({ action: "add", task: "Med", priority: "medium" });
    await runTodo({ action: "add", task: "Low", priority: "low" });
    await runTodo({ action: "add", task: "None" });

    const result = await runTodo({ action: "list" });
    expect(result.content).toContain("[pending] High ‼");
    expect(result.content).toContain("[pending] Med !");
    expect(result.content).toContain("[pending] Low ·");
    expect(result.content).toContain("[pending] None");
    expect(result.content).not.toMatch(/None [‼!·]/);
  });

  it("updates priority via update action", async () => {
    await runTodo({ action: "add", task: "Task" });
    const result = await runTodo({ action: "update", id: 1, priority: "high" });
    expect(result.content).toContain("priority: high");

    const list = await runTodo({ action: "list" });
    expect(list.content).toContain("[pending] Task ‼");
  });
});

describe("blocked_by (dependencies)", () => {
  beforeEach(async () => {
    await runTodo({ action: "clear" });
  });

  it("adds task with dependencies", async () => {
    await runTodo({ action: "add", task: "Design" });
    const result = await runTodo({ action: "add", task: "Build", blocked_by: [1] });
    expect(result.content).toContain("blocked by: #1");
    expect(result.is_error).toBeUndefined();
  });

  it("rejects dependency on non-existent task", async () => {
    const result = await runTodo({ action: "add", task: "Build", blocked_by: [99] });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("dependency task #99 not found");
  });

  it("prevents starting a blocked task", async () => {
    await runTodo({ action: "add", task: "Design" });
    await runTodo({ action: "add", task: "Build", blocked_by: [1] });

    const result = await runTodo({ action: "update", id: 2, status: "in_progress" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("blocked by incomplete tasks");
  });

  it("allows starting task after dependencies complete", async () => {
    await runTodo({ action: "add", task: "Design" });
    await runTodo({ action: "add", task: "Build", blocked_by: [1] });
    await runTodo({ action: "update", id: 1, status: "done" });

    const result = await runTodo({ action: "update", id: 2, status: "in_progress" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("status: in_progress");
  });

  it("shows blocking indicator in display", async () => {
    await runTodo({ action: "add", task: "Research" });
    await runTodo({ action: "add", task: "Write report", blocked_by: [1] });

    const result = await runTodo({ action: "list" });
    expect(result.content).toContain("[pending] Write report ⊘#1");
  });

  it("blocking indicator clears when dependency done", async () => {
    await runTodo({ action: "add", task: "Research" });
    await runTodo({ action: "add", task: "Write report", blocked_by: [1] });
    await runTodo({ action: "update", id: 1, status: "done" });

    const result = await runTodo({ action: "list" });
    expect(result.content).toContain("[pending] Write report");
    expect(result.content).not.toContain("⊘");
  });

  it("rejects self-dependency in update", async () => {
    await runTodo({ action: "add", task: "Task" });
    const result = await runTodo({ action: "update", id: 1, blocked_by: [1] });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("cannot depend on itself");
  });

  it("update requires at least one field to change", async () => {
    await runTodo({ action: "add", task: "Task" });
    const result = await runTodo({ action: "update", id: 1 });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("status, priority, blocked_by, or notes required");
  });
});
