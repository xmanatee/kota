import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { executeWorkflowRun } from "./run-executor.js";
import { DEFAULT_STEP_TIMEOUT_MS } from "./run-executor-step.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition, WorkflowRunTrigger } from "./types.js";

function makeDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: "test",
    enabled: true,
    recoveryCapable: false,
    definitionPath: "src/modules/test/workflows/test/workflow.ts",
    triggers: [],
    steps: [],
    ...overrides,
    tags: overrides.tags ?? [],
  };
}

const TRIGGER: WorkflowRunTrigger = { event: "runtime.idle", payload: {} };

describe("continueOnFailure", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-run-executor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("subsequent steps run when a continueOnFailure step fails", async () => {
    const executed: string[] = [];
    const definition = makeDefinition({
      steps: [
        {
          id: "optional-step",
          type: "code",
          continueOnFailure: true,
          run: () => {
            executed.push("optional-step");
            throw new Error("transient failure");
          },
        },
        {
          id: "next-step",
          type: "code",
          run: () => {
            executed.push("next-step");
            return { ok: true };
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    await promise;

    expect(executed).toEqual(["optional-step", "next-step"]);
  });

  it("run finishes with completed-with-warnings when a continueOnFailure step fails", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "optional-step",
          type: "code",
          continueOnFailure: true,
          run: () => {
            throw new Error("non-critical error");
          },
        },
      ],
    });

    const completed: unknown[] = [];
    bus.on("workflow.completed", (payload) => completed.push(payload));

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    await promise;

    expect(completed).toHaveLength(1);
    expect((completed[0] as { status: string }).status).toBe("completed-with-warnings");
  });

  it("failed continueOnFailure step result has continueOnFailure flag set in stored metadata", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "optional-step",
          type: "code",
          continueOnFailure: true,
          run: () => {
            throw new Error("boom");
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    await promise;

    const runDirs = readdirSync(join(projectDir, ".kota", "runs"));
    const metadata = JSON.parse(
      readFileSync(join(projectDir, ".kota", "runs", runDirs[0], "metadata.json"), "utf-8"),
    ) as { steps: Array<{ status: string; continueOnFailure?: boolean; error?: string }> };

    expect(metadata.steps).toHaveLength(1);
    expect(metadata.steps[0].status).toBe("failed");
    expect(metadata.steps[0].continueOnFailure).toBe(true);
    expect(metadata.steps[0].error).toBe("boom");
  });

  it("run aborts normally when a step without continueOnFailure fails", async () => {
    const executed: string[] = [];
    const definition = makeDefinition({
      steps: [
        {
          id: "critical-step",
          type: "code",
          run: () => {
            executed.push("critical-step");
            throw new Error("critical failure");
          },
        },
        {
          id: "unreachable-step",
          type: "code",
          run: () => {
            executed.push("unreachable-step");
          },
        },
      ],
    });

    const completed: unknown[] = [];
    bus.on("workflow.completed", (payload) => completed.push(payload));

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    await promise;

    expect(executed).toEqual(["critical-step"]);
    expect((completed[0] as { status: string }).status).toBe("failed");
  });

  it("run finishes with success when no steps fail", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "normal-step",
          type: "code",
          continueOnFailure: true,
          run: () => "ok",
        },
      ],
    });

    const completed: unknown[] = [];
    bus.on("workflow.completed", (payload) => completed.push(payload));

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    await promise;

    expect((completed[0] as { status: string }).status).toBe("success");
  });

  it("next step can inspect failed continueOnFailure step result via stepResults", async () => {
    let capturedResult: unknown;
    const definition = makeDefinition({
      steps: [
        {
          id: "optional-step",
          type: "code",
          continueOnFailure: true,
          run: () => {
            throw new Error("non-critical");
          },
        },
        {
          id: "check-step",
          type: "code",
          run: (ctx) => {
            capturedResult = ctx.stepResults["optional-step"];
            return "done";
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      projectDir,
      bus,
      store,
      log,
    });
    await promise;

    expect((capturedResult as { status: string }).status).toBe("failed");
    expect((capturedResult as { error: string }).error).toBe("non-critical");
  });
});

describe("step timeout", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-step-timeout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("DEFAULT_STEP_TIMEOUT_MS is 30 minutes", () => {
    expect(DEFAULT_STEP_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  it("fails the run when a step exceeds its timeoutMs", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "hanging-step",
          type: "code",
          timeoutMs: 50,
          run: () => new Promise(() => {}), // never resolves
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    const errorLog = (log.mock.calls as string[][]).flat().find((msg) => msg.includes("Failed"));
    expect(errorLog).toContain("hanging-step");
    expect(errorLog).toContain("timed out");
  }, 10_000);

  it("run status is 'failed' (not 'interrupted') on step timeout", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "slow-step",
          type: "code",
          timeoutMs: 50,
          run: () => new Promise(() => {}),
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
  }, 10_000);

  it("subsequent steps do not run after a timeout failure", async () => {
    const executed: string[] = [];
    const definition = makeDefinition({
      steps: [
        {
          id: "slow-step",
          type: "code",
          timeoutMs: 50,
          run: () => new Promise(() => {}),
        },
        {
          id: "unreachable-step",
          type: "code",
          run: () => { executed.push("unreachable-step"); },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    await promise;

    expect(executed).toEqual([]);
  }, 10_000);

  it("emits workflow.failure.alert on step timeout", async () => {
    const { subscribeWorkflowFailureAlert } = await import("./failure-alert.js");
    subscribeWorkflowFailureAlert(bus, projectDir);

    const alerts: unknown[] = [];
    bus.on("workflow.failure.alert", (payload) => alerts.push(payload));

    const definition = makeDefinition({
      steps: [
        {
          id: "stuck-step",
          type: "code",
          timeoutMs: 50,
          run: () => new Promise(() => {}),
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    await promise;

    expect(alerts).toHaveLength(1);
    expect((alerts[0] as { status: string }).status).toBe("failed");
  }, 10_000);
});

describe("foreach step timeout", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-foreach-timeout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("fails the run when a foreach step exceeds its timeoutMs", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "hanging-foreach",
          type: "foreach",
          timeoutMs: 50,
          items: [1, 2, 3],
          as: "item",
          steps: [
            {
              id: "inner",
              type: "code",
              run: () => new Promise(() => {}), // never resolves
            },
          ],
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    const errorLog = (log.mock.calls as string[][]).flat().find((msg) => msg.includes("Failed"));
    expect(errorLog).toContain("hanging-foreach");
    expect(errorLog).toContain("timed out");
  }, 10_000);

  it("run status is 'failed' (not 'interrupted') on foreach step timeout", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "slow-foreach",
          type: "foreach",
          timeoutMs: 50,
          items: [1],
          as: "item",
          steps: [
            {
              id: "inner",
              type: "code",
              run: () => new Promise(() => {}),
            },
          ],
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
  }, 10_000);
});

describe("per-run cost cap", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-cost-cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("fails the run when accumulated cost exceeds costLimitUsd", async () => {
    const definition = makeDefinition({
      costLimitUsd: 0.10,
      steps: [
        {
          id: "expensive-step",
          type: "code",
          run: () => ({ totalCostUsd: 0.20 }),
        },
        {
          id: "unreachable-step",
          type: "code",
          run: () => "should not run",
        },
      ],
    });

    const completed: unknown[] = [];
    bus.on("workflow.completed", (payload) => completed.push(payload));

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect((completed[0] as { status: string }).status).toBe("failed");
    const errorLog = (log.mock.calls as string[][]).flat().find((msg) => msg.includes("Failed"));
    expect(errorLog).toContain("cost cap");
  });

  it("does not fail when accumulated cost is under costLimitUsd", async () => {
    const executed: string[] = [];
    const definition = makeDefinition({
      costLimitUsd: 1.00,
      steps: [
        {
          id: "cheap-step",
          type: "code",
          run: () => {
            executed.push("cheap-step");
            return { totalCostUsd: 0.05 };
          },
        },
        {
          id: "next-step",
          type: "code",
          run: () => {
            executed.push("next-step");
            return "done";
          },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(executed).toEqual(["cheap-step", "next-step"]);
  });

  it("emits workflow.failure.alert when cost cap is exceeded", async () => {
    const { subscribeWorkflowFailureAlert } = await import("./failure-alert.js");
    subscribeWorkflowFailureAlert(bus, projectDir);

    const alerts: unknown[] = [];
    bus.on("workflow.failure.alert", (payload) => alerts.push(payload));

    const definition = makeDefinition({
      costLimitUsd: 0.01,
      steps: [
        {
          id: "over-budget-step",
          type: "code",
          run: () => ({ totalCostUsd: 0.50 }),
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    await promise;

    expect(alerts).toHaveLength(1);
    expect((alerts[0] as { status: string }).status).toBe("failed");
  });
});

describe("outputSchema validation", () => {
  let projectDir: string;
  let store: WorkflowRunStore;
  let bus: EventBus;
  const log = vi.fn();

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-output-schema-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    store = new WorkflowRunStore(projectDir);
    bus = new EventBus();
    log.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("run succeeds when last step output matches outputSchema", async () => {
    const definition = makeDefinition({
      outputSchema: { type: "object", properties: { value: { type: "number" } }, required: ["value"] },
      steps: [
        {
          id: "step",
          type: "code",
          run: () => ({ value: 42 }),
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.warnings).toBeUndefined();
  });

  it("run is completed-with-warnings when last step output mismatches outputSchema", async () => {
    const definition = makeDefinition({
      outputSchema: { type: "object", properties: { value: { type: "number" } }, required: ["value"] },
      steps: [
        {
          id: "step",
          type: "code",
          run: () => ({ value: "not-a-number" }),
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("completed-with-warnings");
    expect(result.metadata.warnings).toHaveLength(1);
    expect(result.metadata.warnings![0].type).toBe("output-schema-mismatch");
    expect(result.metadata.warnings![0].message).toContain("value");
  });

  it("run succeeds with no warnings when outputSchema is absent", async () => {
    const definition = makeDefinition({
      steps: [
        {
          id: "step",
          type: "code",
          run: () => ({ whatever: true }),
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.warnings).toBeUndefined();
  });

  it("output schema mismatch warning is persisted in metadata.json", async () => {
    const definition = makeDefinition({
      outputSchema: { type: "object", required: ["name"] },
      steps: [
        {
          id: "step",
          type: "code",
          run: () => ({ notName: "oops" }),
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    await promise;

    const runDirs = readdirSync(join(projectDir, ".kota", "runs"));
    const metadata = JSON.parse(
      readFileSync(join(projectDir, ".kota", "runs", runDirs[0], "metadata.json"), "utf-8"),
    ) as { status: string; warnings?: Array<{ type: string; message: string }> };

    expect(metadata.status).toBe("completed-with-warnings");
    expect(metadata.warnings).toHaveLength(1);
    expect(metadata.warnings![0].type).toBe("output-schema-mismatch");
  });

  it("output schema is not validated when run fails", async () => {
    const definition = makeDefinition({
      outputSchema: { type: "object", required: ["value"] },
      steps: [
        {
          id: "step",
          type: "code",
          run: () => { throw new Error("step failed"); },
        },
      ],
    });

    const { promise } = executeWorkflowRun(definition, TRIGGER, { projectDir, bus, store, log });
    const result = await promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.metadata.warnings).toBeUndefined();
  });
});
