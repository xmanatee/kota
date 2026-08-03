import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import improverWorkflow from "./workflow.js";

const cleanWorktreeStatus = {
  available: true,
  dirty: false,
  trackedDirty: false,
  entries: [],
  fingerprint: "",
  summary: "clean",
  headSha: "abc123",
};

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(() => ({
    available: true,
    dirty: false,
    trackedDirty: false,
    entries: [],
    fingerprint: "",
    summary: "clean",
    headSha: "abc123",
  })),
}));

vi.mock("#modules/autonomy/commit.js", () => ({
  commitWorkflowChanges: vi.fn(),
}));

vi.mock("#modules/autonomy/run-summary.js", () => ({
  writeRunSummary: vi.fn(() => ({
    runId: "test-run",
    workflow: "improver",
    taskId: null,
    taskTitle: null,
    outcome: "success",
    commitSha: "abc123",
    commitMessage: "test",
    filesChanged: [],
    costUsd: null,
    durationMs: null,
    completedAt: new Date().toISOString(),
  })),
}));

describe("improver workflow", () => {
  let projectDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepoWorktreeStatus).mockReturnValue(cleanWorktreeStatus);
    projectDir = join(
      tmpdir(),
      `kota-improver-workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function writeFailedRun(id = "failed-builder-run"): void {
    const runDir = join(projectDir, ".kota", "runs", id);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({
        id,
        workflow: "builder",
        definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
        trigger: { event: "runtime.idle", payload: {} },
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: "failed",
        runDir: `.kota/runs/${id}`,
        steps: [],
      }),
    );
  }

  function writeTask(
    state: string,
    id: string,
    options: { taskClass?: "Product" | "Safety" | "Platform" | "Meta"; body?: string } = {},
  ): void {
    const taskDir = join(projectDir, "data", "tasks", state);
    mkdirSync(taskDir, { recursive: true });
    const lines = [
      "---",
      `id: ${id}`,
      `title: ${id}`,
      `status: ${state}`,
      "priority: p1",
      "area: autonomy",
      `summary: ${id} summary`,
      "created_at: 2026-06-01T00:00:00.000Z",
      "updated_at: 2026-06-01T00:00:00.000Z",
    ];
    if (options.taskClass) lines.push(`task_class: ${options.taskClass}`);
    lines.push("---", "", options.body ?? "## Problem\n\nTask body.\n");
    writeFileSync(join(taskDir, `${id}.md`), `${lines.join("\n")}\n`);
  }

  it("uses evidence gating rather than trigger cooldowns for pacing", () => {
    for (const trigger of improverWorkflow.triggers) {
      expect(trigger.cooldownMs, `${trigger.event} should not delay evidence checks`).toBeUndefined();
    }
  });

  it("keeps lint validation read-only", async () => {
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({
        scripts: {
          lint: "node -e \"process.exit(0)\"",
          "lint:fix":
            "node -e \"require('node:fs').writeFileSync('lint-fix-ran', '')\"",
        },
      }),
    );
    const improve = improverWorkflow.steps.find((step) => step.id === "improve");
    if (improve?.type !== "agent" || !improve.repairLoop) {
      throw new Error("improver agent step has no repair loop");
    }
    const lint = improve.repairLoop.checks.find((check) => check.id === "lint");
    if (!lint || lint.type !== "code") {
      throw new Error("improver repair loop has no code lint check");
    }

    await lint.run({ projectDir } as never, {} as never);

    expect(existsSync(join(projectDir, "lint-fix-ran"))).toBe(false);
  });

  it("exposes task-class and operator-evidence governance to the agent", async () => {
    writeTask("ready", "task-meta-missing-link", { taskClass: "Meta" });
    writeTask("done", "task-product-without-evidence", {
      taskClass: "Product",
      body: "## Acceptance Evidence\n\n- Unit tests passed.\n",
    });

    const step = improverWorkflow.steps.find(
      (candidate) => candidate.id === "gather-task-governance",
    );
    expect(step).toEqual(expect.objectContaining({ exposeOutputToAgent: true }));

    const harness = new WorkflowTestHarness(improverWorkflow, {
      projectDir,
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "builder", status: "success" },
      },
      stepMocks: {
        improve: { turns: [], totalCostUsd: 0.1 },
      },
    });

    const result = await harness.run();

    expect(result.steps["gather-task-governance"].status).toBe("success");
    expect(result.steps["gather-task-governance"].output).toMatchObject({
      openByTaskClass: [{ taskClass: "Meta", count: 1 }],
      actionableMetaWithoutProductSafetyLink: [
        expect.objectContaining({ taskId: "task-meta-missing-link" }),
      ],
      productDoneWithoutOperatorEvidence: [
        expect.objectContaining({ taskId: "task-product-without-evidence" }),
      ],
    });
  });

  it("skips commit and request-restart when improve fails", async () => {
    writeFailedRun();

    // No mock provided for improve → harness fails the agent step
    const harness = new WorkflowTestHarness(improverWorkflow, {
      projectDir,
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "builder", status: "success" },
      },
      stepMocks: {},
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps["gate-evidence"].status).toBe("success");
    expect(result.steps.improve.status).toBe("failed");
    expect(result.steps["record-evidence-fingerprint"]).toBeUndefined();
    expect(result.steps.commit).toBeUndefined();
    expect(result.steps["request-restart"]).toBeUndefined();
  });

  it("runs request-restart when improve succeeds and commit commits", async () => {
    writeFailedRun();
    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(improverWorkflow, {
      projectDir,
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "builder", status: "success" },
      },
      stepMocks: {
        improve: { turns: [], totalCostUsd: 0.1 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps.improve.status).toBe("success");
    expect(result.steps["record-evidence-fingerprint"].status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
    expect(result.steps["write-run-summary"].status).toBe("success");
    expect(result.steps["request-restart"].status).toBe("success");
  });

  it("skips request-restart and write-run-summary when nothing was committed", async () => {
    writeFailedRun();
    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: false } as never);

    const harness = new WorkflowTestHarness(improverWorkflow, {
      projectDir,
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "builder", status: "success" },
      },
      stepMocks: {
        improve: { turns: [], totalCostUsd: 0.05 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps.improve.status).toBe("success");
    expect(result.steps["record-evidence-fingerprint"].status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
    expect(result.steps["write-run-summary"].status).toBe("skipped");
    expect(result.steps["request-restart"].status).toBe("skipped");
  });

  it("skips the agent step when the recent aggregate has no actionable evidence", async () => {
    const harness = new WorkflowTestHarness(improverWorkflow, {
      projectDir,
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "builder", status: "success" },
      },
      stepMocks: {
        improve: { turns: [], totalCostUsd: 0.1 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["gate-evidence"].status).toBe("success");
    expect(result.steps.improve.status).toBe("skipped");
    expect(result.steps["record-evidence-fingerprint"].status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
    expect(result.steps["write-run-summary"].status).toBe("skipped");
    expect(result.steps["request-restart"].status).toBe("skipped");
  });

  it("skips the agent step when the canonical checkout is dirty", async () => {
    writeFailedRun();
    vi.mocked(getRepoWorktreeStatus).mockReturnValue({
      available: true,
      dirty: true,
      trackedDirty: true,
      entries: [" M src/modules/autonomy/workflows/improver/workflow.ts"],
      fingerprint: " M src/modules/autonomy/workflows/improver/workflow.ts",
      summary: "M src/modules/autonomy/workflows/improver/workflow.ts",
      headSha: "abc123",
    });

    const harness = new WorkflowTestHarness(improverWorkflow, {
      projectDir,
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "builder", status: "success" },
      },
      stepMocks: {
        improve: { turns: [], totalCostUsd: 0.1 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-worktree"].output).toMatchObject({ dirty: true });
    expect(result.steps.improve.status).toBe("skipped");
    expect(result.steps["record-evidence-fingerprint"].status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
  });

  it("write-run-summary step exists and appears before request-restart", () => {
    const steps = improverWorkflow.steps;
    const summaryIdx = steps.findIndex((s) => s.id === "write-run-summary");
    const restartIdx = steps.findIndex((s) => s.id === "request-restart");
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(restartIdx).toBeGreaterThan(summaryIdx);
  });
});
