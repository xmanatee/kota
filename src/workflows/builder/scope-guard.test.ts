import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStepContext } from "../../workflow/run-types.js";
import { runScopeGuard } from "./scope-guard.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `scope-guard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, "tasks", "ready"), { recursive: true });
  mkdirSync(join(dir, "tasks", "doing"), { recursive: true });
  mkdirSync(join(dir, "tasks", "blocked"), { recursive: true });
  mkdirSync(join(dir, ".kota", "runs", "test"), { recursive: true });
  return dir;
}

function writeTask(dir: string, state: string, fileName: string, content: string): void {
  writeFileSync(join(dir, "tasks", state, fileName), content, "utf-8");
}

type EmitEntry = { event: string; payload: Record<string, unknown> };

function makeCtx(projectDir: string): WorkflowStepContext & { _emitted: EmitEntry[] } {
  const emitted: EmitEntry[] = [];
  const ctx = {
    projectDir,
    workflow: {
      name: "builder",
      definitionPath: "src/workflows/builder/workflow.ts",
      runId: "test-run-id",
      runDir: ".kota/runs/test",
      runDirPath: join(projectDir, ".kota/runs/test"),
    },
    trigger: { event: "workflow.completed", payload: {} },
    previousOutput: undefined,
    stepOutputs: {},
    stepResults: {},
    stepOutputList: [],
    emit: (event: string, payload: Record<string, unknown>) => {
      emitted.push({ event, payload });
    },
    runTool: async () => ({ content: "" }),
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
    triggerWorkflow: async () => ({ runId: "", status: "queued" as const }),
    _emitted: emitted,
  };
  return ctx as unknown as WorkflowStepContext & { _emitted: EmitEntry[] };
}

function normalTaskContent(priority = "p2", id = "task-normal"): string {
  return `---
id: ${id}
title: A normal sized task
status: ready
priority: ${priority}
area: runtime
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T00:00:00Z
---

## Problem

This is a normal task with modest scope.

## Desired Outcome

A simple change that fits within the execution budget.

## Done When

- Feature X is implemented.
- Tests pass.
- Types check.
`;
}

function oversizedWordCountContent(id = "task-oversized"): string {
  const manyWords = "word ".repeat(750);
  return `---
id: ${id}
title: A giant task
status: ready
priority: p2
area: runtime
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T00:00:00Z
---

## Problem

${manyWords}

## Done When

- Item 1.
- Item 2.
`;
}

function manyDoneWhenItemsContent(id = "task-many-items"): string {
  const items = Array.from({ length: 9 }, (_, i) => `- Done when item ${i + 1}.`).join("\n");
  return `---
id: ${id}
title: Task with many requirements
status: ready
priority: p2
area: runtime
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T00:00:00Z
---

## Problem

A task that has too many independent done-when items.

## Done When

${items}
`;
}

function combinedSignalsContent(id = "task-combined"): string {
  const words = "word ".repeat(480);
  const items = Array.from({ length: 6 }, (_, i) => `- Item ${i + 1}.`).join("\n");
  return `---
id: ${id}
title: Combined signals task
status: ready
priority: p2
area: runtime
created_at: 2026-04-01T00:00:00Z
updated_at: 2026-04-01T00:00:00Z
---

## Problem

${words}

## Done When

${items}
`;
}

describe("runScopeGuard", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns blocked:false with null taskId when no tasks exist", () => {
    const result = runScopeGuard(makeCtx(projectDir));
    expect(result).toEqual({ blocked: false, taskId: null });
  });

  it("returns blocked:false for a normal-sized task in ready/", () => {
    writeTask(projectDir, "ready", "task-normal.md", normalTaskContent());
    const result = runScopeGuard(makeCtx(projectDir));
    expect(result).toEqual({ blocked: false, taskId: "task-normal" });
  });

  it("returns blocked:false for a normal-sized task in doing/", () => {
    writeTask(projectDir, "doing", "task-normal.md", normalTaskContent());
    const result = runScopeGuard(makeCtx(projectDir));
    expect(result).toEqual({ blocked: false, taskId: "task-normal" });
  });

  it("prefers doing/ over ready/ when both have tasks", () => {
    writeTask(projectDir, "doing", "task-doing.md", normalTaskContent("p3", "task-doing"));
    writeTask(projectDir, "ready", "task-ready.md", normalTaskContent("p1", "task-ready"));
    const result = runScopeGuard(makeCtx(projectDir));
    expect(result).toMatchObject({ blocked: false, taskId: "task-doing" });
  });

  it("selects highest priority task from ready/ when multiple exist", () => {
    writeTask(projectDir, "ready", "task-p3.md", normalTaskContent("p3", "task-p3"));
    writeTask(projectDir, "ready", "task-p1.md", normalTaskContent("p1", "task-p1"));
    const result = runScopeGuard(makeCtx(projectDir));
    expect(result).toMatchObject({ blocked: false, taskId: "task-p1" });
  });

  it("blocks a task exceeding the word count threshold", () => {
    writeTask(projectDir, "ready", "task-oversized.md", oversizedWordCountContent());
    const ctx = makeCtx(projectDir);
    const result = runScopeGuard(ctx);

    expect(result.blocked).toBe(true);
    if (!result.blocked) return;
    expect(result.taskId).toBe("task-oversized");
    expect(result.wordCount).toBeGreaterThanOrEqual(700);
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["mv"]),
      expect.any(Object),
    );
    expect(ctx._emitted).toHaveLength(1);
    expect(ctx._emitted[0].event).toBe("workflow.attention.digest");
  });

  it("blocks a task exceeding the done-when items threshold", () => {
    writeTask(projectDir, "ready", "task-many.md", manyDoneWhenItemsContent());
    const ctx = makeCtx(projectDir);
    const result = runScopeGuard(ctx);

    expect(result.blocked).toBe(true);
    if (!result.blocked) return;
    expect(result.taskId).toBe("task-many-items");
    expect(result.doneWhenItems).toBeGreaterThanOrEqual(8);
    expect(vi.mocked(execFileSync)).toHaveBeenCalled();
  });

  it("blocks a task hitting combined word+items signals", () => {
    writeTask(projectDir, "ready", "task-combined.md", combinedSignalsContent());
    const result = runScopeGuard(makeCtx(projectDir));

    expect(result.blocked).toBe(true);
    if (!result.blocked) return;
    expect(result.taskId).toBe("task-combined");
  });

  it("bypasses the guard when allow_oversized: true is in frontmatter", () => {
    const content = oversizedWordCountContent().replace(
      /^updated_at:.+$/m,
      "updated_at: 2026-04-01T00:00:00Z\nallow_oversized: true",
    );
    writeTask(projectDir, "ready", "task-oversized.md", content);
    const result = runScopeGuard(makeCtx(projectDir));

    expect(result.blocked).toBe(false);
    expect(result.taskId).toBe("task-oversized");
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  });

  it("updates frontmatter status to blocked and adds blocked_reason when blocking", () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      if (Array.isArray(args) && args[0] === "mv") {
        renameSync(args[1] as string, args[2] as string);
      }
      return Buffer.from("");
    });

    writeTask(projectDir, "ready", "task-oversized.md", oversizedWordCountContent());
    runScopeGuard(makeCtx(projectDir));

    const blockedContent = readFileSync(
      join(projectDir, "tasks", "blocked", "task-oversized.md"),
      "utf-8",
    );
    expect(blockedContent).toMatch(/^status: blocked/m);
    expect(blockedContent).toMatch(/^blocked_reason:/m);
  });
});
