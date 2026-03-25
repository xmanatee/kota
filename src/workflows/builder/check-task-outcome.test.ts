import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkTaskOutcome } from "./check-task-outcome.js";

function makeTaskFile(
  projectDir: string,
  state: string,
  taskId: string,
): void {
  const dir = join(projectDir, "tasks", state);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${taskId}.md`), `---\nid: ${taskId}\nstatus: ${state}\n---\n`);
}

describe("checkTaskOutcome", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-check-outcome-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(join(projectDir, "tasks"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns resolved=true and finalState=done when task is in done/", () => {
    makeTaskFile(projectDir, "done", "task-foo");
    expect(checkTaskOutcome(projectDir, "task-foo")).toEqual({
      taskId: "task-foo",
      resolved: true,
      finalState: "done",
    });
  });

  it("returns resolved=false and finalState=doing when task is still in doing/", () => {
    makeTaskFile(projectDir, "doing", "task-foo");
    expect(checkTaskOutcome(projectDir, "task-foo")).toEqual({
      taskId: "task-foo",
      resolved: false,
      finalState: "doing",
    });
  });

  it("returns resolved=false and finalState=ready when task was moved back to ready/", () => {
    makeTaskFile(projectDir, "ready", "task-foo");
    expect(checkTaskOutcome(projectDir, "task-foo")).toEqual({
      taskId: "task-foo",
      resolved: false,
      finalState: "ready",
    });
  });

  it("returns resolved=false and finalState=missing when task file is not found anywhere", () => {
    expect(checkTaskOutcome(projectDir, "task-ghost")).toEqual({
      taskId: "task-ghost",
      resolved: false,
      finalState: "missing",
    });
  });
});
