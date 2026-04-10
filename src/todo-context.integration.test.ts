import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Context } from "./core/loop/context.js";
import { initTaskStore, resetTaskStore } from "./core/daemon/task-store.js";
import { runTodo } from "./core/tools/todo.js";

beforeAll(() => {
  initTaskStore(process.cwd(), null); // in-memory mode for tests
});

afterAll(() => {
  resetTaskStore();
});

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
    expect(dynamic).toMatch(/^\[Current time: .+\]$/);
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

  it("priority icons appear in context dynamic state", async () => {
    await runTodo({ action: "add", task: "Critical bug", priority: "high" });
    await runTodo({ action: "add", task: "Nice to have", priority: "low" });
    await runTodo({ action: "add", task: "Should do", priority: "medium" });
    const ctx = new Context("base");
    const dynamic = ctx.getDynamicState();
    expect(dynamic).toContain("Critical bug ‼");
    expect(dynamic).toContain("Nice to have ·");
    expect(dynamic).toContain("Should do !");
    // medium "!" must not match high "‼" — verify exact icon
    const lines = dynamic.split("\n");
    const mediumLine = lines.find((l: string) => l.includes("Should do"));
    expect(mediumLine).toMatch(/Should do !$/);
  });

  it("blocked_by indicators appear in context and clear when deps done", async () => {
    await runTodo({ action: "add", task: "Design" });
    await runTodo({ action: "add", task: "Implement", blocked_by: [1] });
    const ctx = new Context("base");
    let dynamic = ctx.getDynamicState();
    expect(dynamic).toContain("Implement ⊘#1");

    // Complete the dependency
    await runTodo({ action: "update", id: 1, status: "done" });
    dynamic = ctx.getDynamicState();
    // Blocker indicator should be gone since dep is done
    expect(dynamic).not.toContain("⊘#1");
    expect(dynamic).toContain("Implement");
  });

  it("priority + blocked_by combine correctly in context", async () => {
    await runTodo({ action: "add", task: "Research" });
    await runTodo({ action: "add", task: "Build MVP", priority: "high", blocked_by: [1] });
    const ctx = new Context("base");
    const dynamic = ctx.getDynamicState();
    // Both priority icon and blocker should appear
    expect(dynamic).toContain("Build MVP ‼ ⊘#1");
  });

  it("multiple blockers show all pending deps in context", async () => {
    await runTodo({ action: "add", task: "API design" });
    await runTodo({ action: "add", task: "DB schema" });
    await runTodo({ action: "add", task: "Backend", blocked_by: [1, 2] });
    const ctx = new Context("base");
    let dynamic = ctx.getDynamicState();
    expect(dynamic).toContain("⊘#1,#2");

    // Complete one dep — only remaining blocker shows
    await runTodo({ action: "update", id: 1, status: "done" });
    dynamic = ctx.getDynamicState();
    expect(dynamic).toContain("⊘#2");
    expect(dynamic).not.toContain("⊘#1,#2");
  });

  it("system prompt includes priority and blocker info end-to-end", async () => {
    await runTodo({ action: "add", task: "Write spec", priority: "high" });
    await runTodo({ action: "add", task: "Code review", blocked_by: [1] });
    const ctx = new Context("base prompt");
    const prompt = ctx.getSystemPrompt();
    expect(prompt).toContain("Write spec ‼");
    expect(prompt).toContain("Code review ⊘#1");
    expect(prompt).toContain("<current-tasks>");
  });
});
