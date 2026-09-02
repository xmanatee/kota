import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import { executeWorkflowRun } from "./run-executor.js";
import {
  createRunExecutorTestFixture,
  makeDefinition,
  type RunExecutorTestFixture,
  TRIGGER,
} from "./run-executor-test-fixture.js";

let fixture: RunExecutorTestFixture;

beforeEach(() => {
  fixture = createRunExecutorTestFixture();
});

afterEach(() => {
  fixture.dispose();
});

describe("continueOnFailure", () => {
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
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: fixture.runContext,
      bus: fixture.bus,
      store: fixture.store,
      log: fixture.log,
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
    fixture.bus.on("workflow.completed", (payload) => completed.push(payload));

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: fixture.runContext,
      bus: fixture.bus,
      store: fixture.store,
      log: fixture.log,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("completed-with-warnings");
    expect(completed).toEqual([]);
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
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: fixture.runContext,
      bus: fixture.bus,
      store: fixture.store,
      log: fixture.log,
    });
    await promise;

    const runDirs = readdirSync(join(fixture.workspaceRoot, ".kota", "runs"));
    const metadata = JSON.parse(
      readFileSync(
        join(fixture.workspaceRoot, ".kota", "runs", runDirs[0], "metadata.json"),
        "utf-8",
      ),
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
    fixture.bus.on("workflow.completed", (payload) => completed.push(payload));

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: fixture.runContext,
      bus: fixture.bus,
      store: fixture.store,
      log: fixture.log,
    });
    const result = await promise;

    expect(executed).toEqual(["critical-step"]);
    expect(result.metadata.status).toBe("failed");
    expect(completed).toEqual([]);
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
    fixture.bus.on("workflow.completed", (payload) => completed.push(payload));

    const { promise } = executeWorkflowRun(definition, TRIGGER, {
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: fixture.runContext,
      bus: fixture.bus,
      store: fixture.store,
      log: fixture.log,
    });
    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(completed).toEqual([]);
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
      readRuntimeState: readEmptyTestWorkflowRuntimeState,
      runContext: fixture.runContext,
      bus: fixture.bus,
      store: fixture.store,
      log: fixture.log,
    });
    await promise;

    expect((capturedResult as { status: string }).status).toBe("failed");
    expect((capturedResult as { error: string }).error).toBe("non-critical");
  });
});
