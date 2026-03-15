import { describe, it, expect, beforeEach } from "vitest";
import { runTodo, getTodoState } from "./tools/todo.js";
import { Context } from "./context.js";

describe("todo → context integration", () => {
  beforeEach(async () => {
    await runTodo({ action: "clear" });
  });

  it("getDynamicState includes todo state exactly once", async () => {
    await runTodo({ action: "add", task: "Test task" });
    const ctx = new Context("base prompt");
    const dynamic = ctx.getDynamicState();
    expect(dynamic).toContain("Test task");
    const matches = dynamic.match(/<current-tasks>/g);
    expect(matches).toHaveLength(1);
  });

  it("getSystemPrompt includes todo state", async () => {
    await runTodo({ action: "add", task: "System task" });
    const ctx = new Context("base prompt");
    const prompt = ctx.getSystemPrompt();
    expect(prompt).toContain("base prompt");
    expect(prompt).toContain("System task");
    expect(prompt).toContain("<current-tasks>");
  });

  it("hierarchical subtasks render correctly in dynamic state", async () => {
    await runTodo({ action: "add", task: "Phase 1" });
    await runTodo({ action: "add", task: "Subtask A", parent_id: 1 });
    await runTodo({ action: "add", task: "Subtask B", parent_id: 1 });
    const ctx = new Context("base");
    const dynamic = ctx.getDynamicState();
    expect(dynamic).toContain("Phase 1");
    expect(dynamic).toContain("  ○ #2 [pending] Subtask A");
    expect(dynamic).toContain("  ○ #3 [pending] Subtask B");
  });

  it("empty todo list produces no todo section in dynamic state", async () => {
    const ctx = new Context("base");
    const dynamic = ctx.getDynamicState();
    expect(dynamic).not.toContain("<current-tasks>");
    expect(dynamic).toBe("");
  });

  it("cleared todos remove state from context", async () => {
    await runTodo({ action: "add", task: "Temporary" });
    const ctx = new Context("base");
    expect(ctx.getDynamicState()).toContain("Temporary");
    await runTodo({ action: "clear" });
    expect(ctx.getDynamicState()).not.toContain("Temporary");
    expect(ctx.getDynamicState()).not.toContain("<current-tasks>");
  });

  it("budget warning appears after todo state without duplication", async () => {
    await runTodo({ action: "add", task: "Budget test" });
    const ctx = new Context("base");
    ctx.setInputTokens(120_000); // 60% budget
    const dynamic = ctx.getDynamicState();
    expect(dynamic).toContain("Budget test");
    expect(dynamic).toContain("<current-tasks>");
    expect(dynamic).toContain("Context budget:");
    const matches = dynamic.match(/<current-tasks>/g);
    expect(matches).toHaveLength(1);
  });

  it("deep nesting displays correctly in context", async () => {
    await runTodo({ action: "add", task: "Level 0" });
    await runTodo({ action: "add", task: "Level 1", parent_id: 1 });
    await runTodo({ action: "add", task: "Level 2", parent_id: 2 });
    const ctx = new Context("base");
    const dynamic = ctx.getDynamicState();
    expect(dynamic).toContain("○ #1 [pending] Level 0");
    expect(dynamic).toContain("  ○ #2 [pending] Level 1");
    expect(dynamic).toContain("    ○ #3 [pending] Level 2");
  });
});
