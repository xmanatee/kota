import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus.js";
import { executeWorkflowRun } from "./run-executor.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition, WorkflowRunTrigger } from "./types.js";

function makeDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: "test",
    enabled: true,
    definitionPath: "src/workflows/test/workflow.ts",
    triggers: [],
    steps: [],
    ...overrides,
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
