import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTONOMY_CHANGE_DECISION_ARTIFACT } from "#modules/autonomy/autonomy-change-decision.js";
import "./workflow-test-support.js";
import { checkMobileTypecheck } from "./project-repair-checks.js";
import { builderRepairChecks } from "./repair-checks.js";
import {
  checkActionableTaskClaimed,
  checkActionableTaskResolved,
} from "./task-state-repair-checks.js";
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

  it("skips package-script repair checks when the project has no package manifest", async () => {
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
      ];
      const checks = new Map(builderRepairChecks().map((check) => [check.id, check]));
      for (const id of packageCheckIds) {
        const check = checks.get(id);
        expect(check?.type).toBe("code");
        if (check?.type !== "code") throw new Error(`Expected ${id} to be a code check`);
        await expect(check.run(ctx, {} as never)).resolves.toBe(
          "OK: no package project present",
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves the broad test suite to the serialized merge gate", () => {
    expect(builderRepairChecks().map((check) => check.id)).not.toContain("test");
    expect(promptContent).toMatch(/merge gate runs the authoritative broad validation/i);
    expect(promptContent).toMatch(/do not run the full `pnpm test` suite/i);
  });

  it("skips mobile typecheck when dependencies are absent and mobile files are unchanged", async () => {
    const dir = join(tmpdir(), `kota-mobile-skip-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, "clients/mobile"), { recursive: true });
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      writeFileSync(join(dir, "clients/mobile/package.json"), "{}\n");
      await expect(checkMobileTypecheck(dir)).resolves.toBe(
        "OK: mobile client dependencies not installed; no staged mobile changes",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips mobile typecheck when dependency markers are incomplete and mobile files are unchanged", async () => {
    const dir = join(tmpdir(), `kota-mobile-partial-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, "clients/mobile/node_modules"), { recursive: true });
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      writeFileSync(join(dir, "clients/mobile/package.json"), "{}\n");
      await expect(checkMobileTypecheck(dir)).resolves.toBe(
        "OK: mobile client dependencies not installed; no staged mobile changes",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails mobile typecheck when staged mobile changes cannot be inspected", async () => {
    const dir = join(tmpdir(), `kota-mobile-no-git-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, "clients/mobile"), { recursive: true });
    try {
      writeFileSync(join(dir, "clients/mobile/package.json"), "{}\n");
      await expect(checkMobileTypecheck(dir)).rejects.toThrow(
        /Cannot inspect staged clients\/mobile changes/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires mobile dependencies when staged mobile files changed", async () => {
    const dir = join(tmpdir(), `kota-mobile-changed-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(dir, "clients/mobile/src"), { recursive: true });
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      writeFileSync(join(dir, "clients/mobile/package.json"), "{}\n");
      writeFileSync(join(dir, "clients/mobile/src/App.tsx"), "export const app = true;\n");
      execFileSync("git", ["add", "clients/mobile"], { cwd: dir, stdio: "ignore" });

      await expect(checkMobileTypecheck(dir)).rejects.toThrow(
        /Mobile client dependencies are not installed/,
      );
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

  it("projects screened evidence before task-queue validation", () => {
    const checks = new Map(builderRepairChecks().map((check) => [check.id, check]));

    expect(checks.get("agent-run-artifacts-ready")?.phase).toBe(1);
    expect(checks.get("calibration-repair-evidence")?.phase).toBe(2);
    expect(checks.get("task-queue-valid")?.phase).toBe(2);
    expect(checks.get("critic-review")?.phase).toBe(3);
  });

  it("reads autonomy change decisions from the builder agent run directory", async () => {
    const dir = join(
      tmpdir(),
      `kota-builder-agent-decision-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const agentRunDir = join(dir, ".kota", "builder-evidence", "agent-run");
    const canonicalRunDir = join(dir, ".kota", "runs", "canonical-run");
    const workflowDir = join(dir, "src", "modules", "autonomy", "workflows", "builder");
    mkdirSync(workflowDir, { recursive: true });
    mkdirSync(agentRunDir, { recursive: true });
    mkdirSync(canonicalRunDir, { recursive: true });

    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "test@test"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
      writeFileSync(join(dir, "README.md"), "init\n");
      execFileSync("git", ["add", "README.md"], { cwd: dir });
      execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });

      writeFileSync(
        join(workflowDir, "workflow.ts"),
        "export const workflow = { repairLoop: true };\n",
      );
      execFileSync("git", ["add", "src/modules/autonomy/workflows/builder/workflow.ts"], {
        cwd: dir,
      });
      writeFileSync(
        join(agentRunDir, AUTONOMY_CHANGE_DECISION_ARTIFACT),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            artifactType: "autonomy-change-decision",
            runId: "agent-run",
            createdAt: "2026-07-07T00:00:00.000Z",
            taskIds: ["task-builder-agent-run-decision"],
            affectedSurfaces: ["builder repair loop"],
            changeClasses: ["workflow", "repair-loop"],
            hypothesis:
              "Worktree-mode builder checks should read decision artifacts where the agent writes them.",
            sourceRefs: ["task:task-builder-agent-run-decision"],
            baselineRefs: [join(canonicalRunDir, AUTONOMY_CHANGE_DECISION_ARTIFACT)],
            candidateRefs: [join(agentRunDir, AUTONOMY_CHANGE_DECISION_ARTIFACT)],
            metricsCompared: [
              {
                name: "decision artifact lookup",
                baseline: "missing in canonical workflow run directory",
                candidate: "present in builder agent run directory",
                unit: "path",
                direction: "improved",
                qualitySignal: true,
              },
            ],
            rolloutMode: "blocking",
            decision: "promote",
            rationale:
              "The repair check now uses the same run directory contract exposed to the builder agent.",
            ownerSafetyExceptions: [],
            followUpTaskIds: [],
          },
          null,
          2,
        )}\n`,
      );

      const check = builderRepairChecks().find(
        (candidate) => candidate.id === AUTONOMY_CHANGE_DECISION_ARTIFACT.replace(".json", ""),
      );
      expect(check?.type).toBe("code");
      if (check?.type !== "code") throw new Error("Expected autonomy-change-decision code check");

      await expect(
        check.run(
          {
            projectDir: dir,
            workspaceDir: dir,
            runtimeResources: {
              profileId: "profile-1",
              agentRunDir,
              env: {},
            },
            workflow: { runDirPath: canonicalRunDir },
          } as never,
          {} as never,
        ),
      ).resolves.toContain("covers 1 material autonomy file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
