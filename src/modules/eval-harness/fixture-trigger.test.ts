import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { inspectBuilderTaskTarget } from "#modules/autonomy/workflows/builder/task-contract.js";
import { loadFixture } from "./fixture.js";
import { fixtureWorkflowTrigger } from "./fixture-trigger.js";
import {
  applyRoundTaskInput,
  cleanupFixtureWorkingDir,
  materializeFixtureWorkingDir,
  publishRoundTaskInput,
} from "./runner-materialize.js";
import { setupFixtureTree } from "./runner-test-profiles.js";

it("binds the named fixture task only after the host publishes its complete input", () => {
  const { fixturesRoot, cleanup } = setupFixtureTree();
  const fixtureDir = join(fixturesRoot, "mini");
  const taskPath = "data/tasks/task-subject.md";
  const task = "---\nstatus: open\npriority: p2\n---\n# Subject\n\nImplement the fixture.\n";
  mkdirSync(join(fixtureDir, "initial/data/tasks"), { recursive: true });
  writeFileSync(join(fixtureDir, "initial", taskPath), task);
  const { workingDir } = materializeFixtureWorkingDir(loadFixture(fixturesRoot, "mini"));
  try {
    const params = { workingDir, workflowName: "builder", builderTaskId: "task-subject" };
    const initial = fixtureWorkflowTrigger(params);
    expect(initial.triggerEvent).toBe("autonomy.queue.available");
    expect(inspectBuilderTaskTarget({ workspaceRoot: workingDir, payload: initial.triggerPayload! }).actionable).toBe(true);
    writeFileSync(join(fixtureDir, "revision.md"), `${task}\nA revised requirement.\n`);
    const input = { kind: "copy-fixture-file", sourcePath: "revision.md", targetPath: taskPath } as const;
    applyRoundTaskInput(input, fixtureDir, workingDir);
    expect(fixtureWorkflowTrigger(params)).toEqual(initial);
    publishRoundTaskInput(input, workingDir);
    expect(inspectBuilderTaskTarget({ workspaceRoot: workingDir, payload: initial.triggerPayload! }).actionable).toBe(false);
    const revised = fixtureWorkflowTrigger(params);
    expect(inspectBuilderTaskTarget({ workspaceRoot: workingDir, payload: revised.triggerPayload! }).actionable).toBe(true);
    expect(() => fixtureWorkflowTrigger({ ...params, builderTaskId: "task-missing" })).toThrow(/not actionable/);
    expect(() => fixtureWorkflowTrigger({ ...params, triggerPayload: {} })).toThrow(/static trigger/);
  } finally {
    cleanupFixtureWorkingDir(workingDir);
    cleanup();
  }
});
