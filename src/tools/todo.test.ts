import { describe, it, expect, beforeEach } from "vitest";
import { runTodo, getTodoState } from "./todo.js";

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
      expect(result.content).toContain("Updated task #1 to done");
      expect(result.is_error).toBeUndefined();
    });

    it("returns error when id is missing", async () => {
      const result = await runTodo({ action: "update", status: "done" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("id is required");
    });

    it("returns error when status is missing", async () => {
      const result = await runTodo({ action: "update", id: 1 });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("status is required");
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
