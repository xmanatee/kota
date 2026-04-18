import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import improverWorkflow, { IMPROVER_COOLDOWN_MS } from "./workflow.js";

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

  it("all triggers have cooldowns to prevent duplicate runs", () => {
    for (const trigger of improverWorkflow.triggers) {
      expect(trigger.cooldownMs, `${trigger.event} should have a cooldown`).toBe(
        IMPROVER_COOLDOWN_MS,
      );
    }
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

  it("write-run-summary step exists and appears before request-restart", () => {
    const steps = improverWorkflow.steps;
    const summaryIdx = steps.findIndex((s) => s.id === "write-run-summary");
    const restartIdx = steps.findIndex((s) => s.id === "request-restart");
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(restartIdx).toBeGreaterThan(summaryIdx);
  });
});
