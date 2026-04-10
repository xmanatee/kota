import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import decomposerWorkflow from "./workflow.js";

vi.mock("#root/json-file.js", () => ({
  readOptionalJsonFile: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    readdirSync: vi.fn(actual.readdirSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

vi.mock("#modules/autonomy/commit.js", () => ({
  commitWorkflowChanges: vi.fn(),
}));

function makeFailedBuilderMetadata(opts: {
  buildDurationMs: number;
  buildError?: string;
}): WorkflowRunMetadata {
  return {
    id: "run-failed-builder",
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: { event: "autonomy.queue.available", payload: {} },
    startedAt: "2026-04-10T20:00:00Z",
    completedAt: "2026-04-10T21:00:00Z",
    status: "failed",
    durationMs: opts.buildDurationMs + 1000,
    runDir: ".kota/runs/run-failed-builder",
    steps: [
      {
        id: "inspect-ready-queue",
        type: "code",
        status: "success",
        startedAt: "2026-04-10T20:00:00Z",
        completedAt: "2026-04-10T20:00:01Z",
        durationMs: 1000,
      },
      {
        id: "build",
        type: "agent",
        status: "failed",
        startedAt: "2026-04-10T20:00:01Z",
        completedAt: "2026-04-10T21:00:00Z",
        durationMs: opts.buildDurationMs,
        error: opts.buildError,
      },
    ],
  };
}

const TRIGGER_PAYLOAD = {
  workflow: "builder",
  runId: "run-failed-builder",
  status: "failed",
  triggerEvent: "autonomy.queue.available",
  durationMs: 3_600_000,
  definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
  runDir: ".kota/runs/run-failed-builder",
};

describe("decomposer workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips decompose when builder failure is not timeout-shaped", async () => {
    const { readOptionalJsonFile } = await import("#root/json-file.js");
    vi.mocked(readOptionalJsonFile).mockReturnValue(
      makeFailedBuilderMetadata({ buildDurationMs: 5 * 60 * 1000 }),
    );

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", payload: TRIGGER_PAYLOAD },
      stepMocks: { decompose: { decomposed: true } },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["assess-failure"].status).toBe("success");
    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: false,
      isTimeout: false,
      reason: expect.stringMatching(/not.*timeout/i),
    });
    expect(result.steps.decompose.status).toBe("skipped");
  });

  it("skips decompose when trigger payload is missing runDir", async () => {
    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "builder", status: "failed" },
      },
      stepMocks: { decompose: { decomposed: true } },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: false,
      reason: expect.stringMatching(/missing/i),
    });
    expect(result.steps.decompose.status).toBe("skipped");
  });

  it("skips decompose when no task found in doing/ or blocked/", async () => {
    const { readOptionalJsonFile } = await import("#root/json-file.js");
    vi.mocked(readOptionalJsonFile).mockReturnValue(
      makeFailedBuilderMetadata({ buildDurationMs: 55 * 60 * 1000 }),
    );

    const fs = await import("node:fs");
    vi.mocked(fs.readdirSync).mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.includes("data/tasks/doing") || p.includes("data/tasks/blocked")) {
        return ["AGENTS.md"] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return [] as unknown as ReturnType<typeof fs.readdirSync>;
    });

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", payload: TRIGGER_PAYLOAD },
      stepMocks: { decompose: { decomposed: true } },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: false,
      isTimeout: true,
      reason: expect.stringMatching(/no task found/i),
    });
    expect(result.steps.decompose.status).toBe("skipped");
  });

  it("runs decompose when timeout-shaped failure with task in doing/", async () => {
    const { readOptionalJsonFile } = await import("#root/json-file.js");
    vi.mocked(readOptionalJsonFile).mockReturnValue(
      makeFailedBuilderMetadata({ buildDurationMs: 55 * 60 * 1000 }),
    );

    const fs = await import("node:fs");
    vi.mocked(fs.readdirSync).mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.includes("data/tasks/doing")) {
        return ["AGENTS.md", "task-big-refactor.md"] as unknown as ReturnType<
          typeof fs.readdirSync
        >;
      }
      return ["AGENTS.md"] as unknown as ReturnType<typeof fs.readdirSync>;
    });

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", payload: TRIGGER_PAYLOAD },
      stepMocks: { decompose: { decomposed: true, subtaskCount: 3 } },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: true,
      isTimeout: true,
      taskId: "task-big-refactor",
      taskPath: "data/tasks/doing/task-big-refactor.md",
    });
    expect(result.steps.decompose.status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
  });

  it("detects timeout from error text even when duration is short", async () => {
    const { readOptionalJsonFile } = await import("#root/json-file.js");
    vi.mocked(readOptionalJsonFile).mockReturnValue(
      makeFailedBuilderMetadata({
        buildDurationMs: 10 * 60 * 1000,
        buildError: "Step timed out after 600000ms",
      }),
    );

    const fs = await import("node:fs");
    vi.mocked(fs.readdirSync).mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.includes("data/tasks/doing")) {
        return ["task-oversized.md"] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return ["AGENTS.md"] as unknown as ReturnType<typeof fs.readdirSync>;
    });

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", payload: TRIGGER_PAYLOAD },
      stepMocks: { decompose: { decomposed: true } },
    });

    const result = await harness.run();

    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: true,
      isTimeout: true,
      taskId: "task-oversized",
    });
  });

  it("falls back to blocked/ when doing/ is empty", async () => {
    const { readOptionalJsonFile } = await import("#root/json-file.js");
    vi.mocked(readOptionalJsonFile).mockReturnValue(
      makeFailedBuilderMetadata({ buildDurationMs: 55 * 60 * 1000 }),
    );

    const fs = await import("node:fs");
    vi.mocked(fs.readdirSync).mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.includes("data/tasks/doing")) {
        return ["AGENTS.md"] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      if (p.includes("data/tasks/blocked")) {
        return ["AGENTS.md", "task-stuck-work.md"] as unknown as ReturnType<
          typeof fs.readdirSync
        >;
      }
      return [] as unknown as ReturnType<typeof fs.readdirSync>;
    });

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", payload: TRIGGER_PAYLOAD },
      stepMocks: { decompose: { decomposed: true } },
    });

    const result = await harness.run();

    expect(result.steps["assess-failure"].output).toMatchObject({
      shouldDecompose: true,
      taskId: "task-stuck-work",
      taskPath: "data/tasks/blocked/task-stuck-work.md",
    });
  });

  it("skips commit when decompose step is skipped", async () => {
    const { readOptionalJsonFile } = await import("#root/json-file.js");
    vi.mocked(readOptionalJsonFile).mockReturnValue(
      makeFailedBuilderMetadata({ buildDurationMs: 5 * 60 * 1000 }),
    );

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", payload: TRIGGER_PAYLOAD },
      stepMocks: { decompose: { decomposed: true } },
    });

    const result = await harness.run();

    expect(result.steps.decompose.status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
    expect(result.steps["request-restart"].status).toBe("skipped");
  });

  it("runs request-restart when decompose succeeds and commit commits", async () => {
    const { readOptionalJsonFile } = await import("#root/json-file.js");
    vi.mocked(readOptionalJsonFile).mockReturnValue(
      makeFailedBuilderMetadata({ buildDurationMs: 55 * 60 * 1000 }),
    );

    const fs = await import("node:fs");
    vi.mocked(fs.readdirSync).mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.includes("data/tasks/doing")) {
        return ["task-big-refactor.md"] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return [] as unknown as ReturnType<typeof fs.readdirSync>;
    });

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", payload: TRIGGER_PAYLOAD },
      stepMocks: { decompose: { decomposed: true } },
    });

    const result = await harness.run();

    expect(result.steps.decompose.status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
    expect(result.steps["request-restart"].status).toBe("success");
  });

  it("skips request-restart when nothing was committed", async () => {
    const { readOptionalJsonFile } = await import("#root/json-file.js");
    vi.mocked(readOptionalJsonFile).mockReturnValue(
      makeFailedBuilderMetadata({ buildDurationMs: 55 * 60 * 1000 }),
    );

    const fs = await import("node:fs");
    vi.mocked(fs.readdirSync).mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.includes("data/tasks/doing")) {
        return ["task-big-refactor.md"] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return [] as unknown as ReturnType<typeof fs.readdirSync>;
    });

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: false } as never);

    const harness = new WorkflowTestHarness(decomposerWorkflow, {
      trigger: { event: "workflow.completed", payload: TRIGGER_PAYLOAD },
      stepMocks: { decompose: { decomposed: true } },
    });

    const result = await harness.run();

    expect(result.steps.decompose.status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
    expect(result.steps["request-restart"].status).toBe("skipped");
  });
});
