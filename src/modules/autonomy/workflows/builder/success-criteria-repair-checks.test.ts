import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkSuccessCriteriaDeclared } from "./success-criteria-repair-checks.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "kota-success-criteria-target-"));
  roots.push(root);
  return root;
}

function writeTask(root: string, id: string, doneWhen: string[]): void {
  const taskDir = join(root, "data/tasks/doing");
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(
    join(taskDir, `${id}.md`),
    [
      "---",
      `id: ${id}`,
      `title: ${id}`,
      "status: doing",
      "---",
      "",
      "## Done When",
      "",
      ...doneWhen.map((item) => `- ${item}`),
      "",
    ].join("\n"),
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("builder success criteria task identity", () => {
  it("counts Done When items from the expected task instead of the first doing task", () => {
    const root = makeRoot();
    const runDir = join(root, ".kota/runs/builder");
    mkdirSync(runDir, { recursive: true });
    writeTask(root, "task-alpha", ["Alpha only."]);
    writeTask(root, "task-target", ["One.", "Two.", "Three."]);
    writeFileSync(join(runDir, "success-criteria.txt"), "1. One\n2. Two\n");

    expect(() =>
      checkSuccessCriteriaDeclared(runDir, root, {
        taskId: "task-target",
        taskPath: "data/tasks/doing/task-target.md",
      })
    ).toThrow(/at least 3 concrete criteria/);
  });
});
