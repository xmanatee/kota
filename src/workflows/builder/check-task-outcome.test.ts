import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkTaskOutcome } from "./check-task-outcome.js";

function makeTaskFile(
  projectDir: string,
  state: string,
  taskId: string,
  body = "",
): void {
  const dir = join(projectDir, "tasks", state);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${taskId}.md`),
    `---\nid: ${taskId}\nstatus: ${state}\n---\n${body}`,
  );
}

function readTaskFile(projectDir: string, state: string, taskId: string): string {
  return readFileSync(join(projectDir, "tasks", state, `${taskId}.md`), "utf8");
}

const ANNOTATION = {
  runId: "2026-01-01T00-00-00-000Z-builder-abc123",
  summary: "agent did not move task to done",
  date: "2026-01-01",
};

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

  describe("failure annotation", () => {
    it("appends Attempt History section on first failure (doing/)", () => {
      makeTaskFile(projectDir, "doing", "task-foo");
      checkTaskOutcome(projectDir, "task-foo", ANNOTATION);
      const content = readTaskFile(projectDir, "doing", "task-foo");
      expect(content).toContain("## Attempt History");
      expect(content).toContain(
        `- 2026-01-01 | 2026-01-01T00-00-00-000Z-builder-abc123 | agent did not move task to done`,
      );
    });

    it("appends Attempt History section on first failure (ready/)", () => {
      makeTaskFile(projectDir, "ready", "task-foo");
      checkTaskOutcome(projectDir, "task-foo", ANNOTATION);
      const content = readTaskFile(projectDir, "ready", "task-foo");
      expect(content).toContain("## Attempt History");
      expect(content).toContain(`- 2026-01-01 |`);
    });

    it("appends second bullet to existing Attempt History section", () => {
      makeTaskFile(
        projectDir,
        "doing",
        "task-foo",
        "\n## Attempt History\n- 2025-12-31 | old-run-id | first failure\n",
      );
      checkTaskOutcome(projectDir, "task-foo", ANNOTATION);
      const content = readTaskFile(projectDir, "doing", "task-foo");
      const idx1 = content.indexOf("- 2025-12-31 | old-run-id | first failure");
      const idx2 = content.indexOf(
        `- 2026-01-01 | 2026-01-01T00-00-00-000Z-builder-abc123 | agent did not move task to done`,
      );
      expect(idx1).toBeGreaterThan(-1);
      expect(idx2).toBeGreaterThan(idx1);
      // Only one heading
      expect(content.split("## Attempt History").length).toBe(2);
    });

    it("does not annotate when task is in done/", () => {
      makeTaskFile(projectDir, "done", "task-foo");
      checkTaskOutcome(projectDir, "task-foo", ANNOTATION);
      const content = readTaskFile(projectDir, "done", "task-foo");
      expect(content).not.toContain("## Attempt History");
    });

    it("does not throw when task file is not found (missing)", () => {
      expect(() =>
        checkTaskOutcome(projectDir, "task-ghost", ANNOTATION),
      ).not.toThrow();
    });

    it("does not annotate when no annotation is provided", () => {
      makeTaskFile(projectDir, "doing", "task-foo");
      checkTaskOutcome(projectDir, "task-foo");
      const content = readTaskFile(projectDir, "doing", "task-foo");
      expect(content).not.toContain("## Attempt History");
    });
  });
});
