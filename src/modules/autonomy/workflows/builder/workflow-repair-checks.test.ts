import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./workflow-test-support.js";
import {
  builderRepairChecks,
  checkActionableTaskClaimed,
  checkActionableTaskResolved,
} from "./repair-checks.js";
import { resetBuilderWorkflowMocks } from "./workflow-test-support.js";

const promptPath = fileURLToPath(new URL("./prompt.md", import.meta.url));
const promptContent = readFileSync(promptPath, "utf-8");
const builderAgentsPath = fileURLToPath(new URL("./AGENTS.md", import.meta.url));
const builderAgentsContent = readFileSync(builderAgentsPath, "utf-8");
const taskAgentsPath = fileURLToPath(new URL("../../../../../data/tasks/AGENTS.md", import.meta.url));
const taskAgentsContent = readFileSync(taskAgentsPath, "utf-8");

describe("builder workflow prompt and repair checks", () => {
  beforeEach(async () => {
    await resetBuilderWorkflowMocks();
  });

  it("keeps task-selection detail in task docs instead of bloating the prompt", () => {
    expect(promptContent).toMatch(/data\/tasks\//);
    expect(promptContent).not.toMatch(/data\/tasks\/doing\//);
    expect(promptContent).not.toMatch(/data\/tasks\/ready\//);
    expect(promptContent).not.toMatch(/data\/tasks\/blocked\//);
    expect(promptContent).toMatch(/prefer P1 Product or\s+Safety work over Meta/);
    expect(taskAgentsContent).toMatch(/State directories define their own lifecycle/i);
  });

  it("keeps success-criteria protocol in local builder instructions", () => {
    expect(promptContent).toMatch(/Declare and verify success criteria in the run directory/);
    expect(promptContent).toMatch(/Done When/);
    expect(promptContent).not.toMatch(/success-criteria\.txt/);
    expect(promptContent).not.toMatch(/success-criteria-verified\.txt/);
    expect(builderAgentsContent).toMatch(/success-criteria\.txt/);
    expect(builderAgentsContent).toMatch(/success-criteria-verified\.txt/);
  });

  it("skips package-script repair checks when the project has no package manifest", () => {
    const dir = join(tmpdir(), `kota-no-package-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      const ctx = { projectDir: dir, workflow: { runDirPath: dir } } as never;
      const packageCheckIds = [
        "build-output",
        "workflow-validate",
        "task-queue-valid",
        "typecheck",
        "lint",
        "test",
      ];
      const checks = new Map(builderRepairChecks().map((check) => [check.id, check]));
      for (const id of packageCheckIds) {
        const check = checks.get(id);
        expect(check?.type).toBe("code");
        if (check?.type !== "code") throw new Error(`Expected ${id} to be a code check`);
        expect(check.run(ctx, {} as never)).toBe("OK: no package project present");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("registers source-file-size as a warning-level builder repair check", () => {
    const check = builderRepairChecks().find((candidate) => candidate.id === "source-file-size");

    expect(check).toMatchObject({
      id: "source-file-size",
      type: "code",
      severity: "warning",
      phase: 1,
    });
  });

  it("fails repair when ready work remains unclaimed", () => {
    const dir = join(tmpdir(), `kota-unclaimed-ready-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, "data/tasks/ready"), { recursive: true });
    try {
      writeFileSync(join(dir, "data/tasks/ready/task-open.md"), "---\nid: task-open\n---\n");
      expect(() => checkActionableTaskClaimed(dir)).toThrow(/has not claimed one/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes repair when ready work has an active claimed task", () => {
    const dir = join(tmpdir(), `kota-claimed-ready-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, "data/tasks/ready"), { recursive: true });
    mkdirSync(join(dir, "data/tasks/doing"), { recursive: true });
    try {
      writeFileSync(join(dir, "data/tasks/ready/task-next.md"), "---\nid: task-next\n---\n");
      writeFileSync(join(dir, "data/tasks/doing/task-active.md"), "---\nid: task-active\n---\n");
      expect(checkActionableTaskClaimed(dir)).toBe("OK: task claimed (1 active or terminal task file(s))");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes repair when ready work has an active claim lease", async () => {
    const dir = join(tmpdir(), `kota-claimed-lease-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, "data/tasks/ready"), { recursive: true });
    try {
      writeFileSync(join(dir, "data/tasks/ready/task-next.md"), "---\nid: task-next\n---\n");
      const { listTaskClaimInspections } = await import("#modules/autonomy/task-claims.js");
      vi.mocked(listTaskClaimInspections).mockReturnValueOnce([
        {
          safeToRetry: false,
          recoveryStatus: "agent-running",
          claim: { taskId: "task-next", owner: "workflow:builder" },
          path: join(dir, ".kota/task-claims/active/task-next.json"),
        },
      ] as never);
      expect(checkActionableTaskClaimed(dir)).toBe("OK: task claimed (1 active lease(s))");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checks whether in-progress work remains open", () => {
    const openDir = join(tmpdir(), `kota-open-doing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(openDir, "data/tasks/doing"), { recursive: true });
    writeFileSync(join(openDir, "data/tasks/doing/task-active.md"), "---\nid: task-active\n---\n");
    expect(() => checkActionableTaskResolved(openDir)).toThrow(/still has 1 task\(s\) in doing/);
    rmSync(openDir, { recursive: true, force: true });

    const doneDir = join(tmpdir(), `kota-no-open-doing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(doneDir, "data/tasks/done"), { recursive: true });
    writeFileSync(join(doneDir, "data/tasks/done/task-done.md"), "---\nid: task-done\n---\n");
    expect(checkActionableTaskResolved(doneDir)).toBe("OK: no in-progress task left open");
    rmSync(doneDir, { recursive: true, force: true });
  });
});
