import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { inspectBuilderTaskTarget } from "#modules/autonomy/workflows/builder/task-contract.js";
import { fixtureWorkflowTrigger } from "./fixture-trigger.js";

it("binds the named fixture task to its current production contract without choosing another task", () => {
  const workingDir = mkdtempSync(join(tmpdir(), "eval-trigger-"));
  try {
    mkdirSync(join(workingDir, "data/tasks"), { recursive: true });
    const taskPath = join(workingDir, "data/tasks/task-subject.md");
    const task = "---\nstatus: open\npriority: p2\n---\n# Subject\n\nImplement the fixture.\n";
    writeFileSync(taskPath, task);
    const params = { workingDir, workflowName: "builder", builderTaskId: "task-subject" };
    const initial = fixtureWorkflowTrigger(params);
    expect(initial.triggerEvent).toBe("autonomy.queue.available");
    expect(inspectBuilderTaskTarget({ workspaceRoot: workingDir, payload: initial.triggerPayload! }).actionable).toBe(true);
    writeFileSync(taskPath, `${task}\nA revised requirement.\n`);
    expect(inspectBuilderTaskTarget({ workspaceRoot: workingDir, payload: initial.triggerPayload! }).actionable).toBe(false);
    const revised = fixtureWorkflowTrigger(params);
    expect(inspectBuilderTaskTarget({ workspaceRoot: workingDir, payload: revised.triggerPayload! }).actionable).toBe(true);
    expect(() => fixtureWorkflowTrigger({ ...params, builderTaskId: "task-missing" })).toThrow(/not actionable/);
    expect(() => fixtureWorkflowTrigger({ ...params, triggerPayload: {} })).toThrow(/static trigger/);
  } finally { rmSync(workingDir, { recursive: true, force: true }); }
});
