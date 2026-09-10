import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { RepairCheckResult } from "./repair-loop-checks.js";
import { repairProgressSnapshot } from "./repair-loop-progress.js";
import { createWorkflowCommandRunner } from "./workflow-command.js";

const roots: string[] = [];

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "kota-repair-progress-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  writeFileSync(join(root, "seed.txt"), "seed\n");
  execFileSync("git", ["add", "seed.txt"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: root });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("repair progress evidence", () => {
  test("fingerprints and renders changing untracked file contents", async () => {
    const root = createRepository();
    const path = join(root, "untracked change.ts");
    const failures: RepairCheckResult[] = [{
      id: "critic",
      passed: false,
      output: "still unresolved",
      severity: "error",
    }];
    const runCommand = createWorkflowCommandRunner({ cwd: root });

    writeFileSync(path, "export const attempt = 1;\n");
    const first = await repairProgressSnapshot(root, failures, runCommand);
    writeFileSync(path, "export const attempt = 2;\n");
    const second = await repairProgressSnapshot(root, failures, runCommand);

    expect(first.changedPaths).toEqual(["untracked change.ts"]);
    expect(first.diff).toContain("+export const attempt = 1;");
    expect(second.diff).toContain("+export const attempt = 2;");
    expect(second.key).not.toBe(first.key);
  });
});
