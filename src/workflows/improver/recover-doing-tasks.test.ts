import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowStepContext } from "../../workflow/types.js";
import { recoverDoingTasks } from "./recover-doing-tasks.js";

const DOING_TASK = `---
id: task-foo
title: Foo
status: doing
priority: p2
area: workflow
summary: A task that got stuck.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

Stuck.

## Desired Outcome

Fixed.

## Constraints

None.

## Done When

Done.
`;

function makeCtx(projectDir: string, triggerStatus: string): WorkflowStepContext {
  return {
    projectDir,
    trigger: {
      event: "workflow.completed",
      payload: { workflow: "builder", status: triggerStatus },
    },
    previousOutput: undefined,
    stepOutputs: {},
    stepResults: {},
    stepOutputList: [],
    workflow: { runId: "test-run", runDir: "test", runDirPath: projectDir },
    runTool: async () => ({ content: "" }),
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({
      completedRuns: 0,
      workflows: {},
    }),
  } as unknown as WorkflowStepContext;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `recover-test-${Date.now()}`);
  mkdirSync(join(tmpDir, "tasks", "doing"), { recursive: true });
  mkdirSync(join(tmpDir, "tasks", "ready"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("recoverDoingTasks", () => {
  it("does nothing when builder succeeded", () => {
    writeFileSync(join(tmpDir, "tasks", "doing", "task-foo.md"), DOING_TASK);
    const result = recoverDoingTasks(makeCtx(tmpDir, "success"));
    expect(result.recovered).toEqual([]);
    expect(result.triggeringStatus).toBe("success");
    expect(existsSync(join(tmpDir, "tasks", "doing", "task-foo.md"))).toBe(true);
  });

  it("recovers stuck tasks when builder failed", () => {
    writeFileSync(join(tmpDir, "tasks", "doing", "task-foo.md"), DOING_TASK);
    const result = recoverDoingTasks(makeCtx(tmpDir, "failed"));
    expect(result.recovered).toEqual(["task-foo.md"]);
    expect(existsSync(join(tmpDir, "tasks", "doing", "task-foo.md"))).toBe(false);
    expect(existsSync(join(tmpDir, "tasks", "ready", "task-foo.md"))).toBe(true);
  });

  it("updates status frontmatter from doing to ready", () => {
    writeFileSync(join(tmpDir, "tasks", "doing", "task-foo.md"), DOING_TASK);
    recoverDoingTasks(makeCtx(tmpDir, "failed"));
    const content = readFileSync(join(tmpDir, "tasks", "ready", "task-foo.md"), "utf-8");
    expect(content).toContain("status: ready");
    expect(content).not.toContain("status: doing");
  });

  it("skips AGENTS.md in doing/", () => {
    writeFileSync(join(tmpDir, "tasks", "doing", "AGENTS.md"), "# Agents");
    const result = recoverDoingTasks(makeCtx(tmpDir, "failed"));
    expect(result.recovered).toEqual([]);
    expect(existsSync(join(tmpDir, "tasks", "doing", "AGENTS.md"))).toBe(true);
  });

  it("returns empty when doing/ is empty on failure", () => {
    const result = recoverDoingTasks(makeCtx(tmpDir, "failed"));
    expect(result.recovered).toEqual([]);
    expect(result.triggeringStatus).toBe("failed");
  });

  it("recovers multiple stuck tasks", () => {
    const task2 = DOING_TASK.replace("id: task-foo", "id: task-bar").replace(
      "task-foo.md",
      "task-bar.md",
    );
    writeFileSync(join(tmpDir, "tasks", "doing", "task-foo.md"), DOING_TASK);
    writeFileSync(join(tmpDir, "tasks", "doing", "task-bar.md"), task2);
    const result = recoverDoingTasks(makeCtx(tmpDir, "failed"));
    expect(result.recovered).toHaveLength(2);
    expect(result.recovered).toContain("task-foo.md");
    expect(result.recovered).toContain("task-bar.md");
  });
});
