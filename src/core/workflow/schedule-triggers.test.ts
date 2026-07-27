import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowRunStore } from "./run-store.js";
import { ScheduleTriggerManager } from "./schedule-triggers.js";
import type { WorkflowRunTrigger, WorkflowTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

function makeDefinition(
  name: string,
  trigger: WorkflowTrigger,
): WorkflowDefinition {
  return {
    name,
    enabled: true,
    definitionPath: `test/${name}.ts`,
    moduleRoot: process.cwd(),
    recoveryCapable: false,
    tags: [],
    triggers: [trigger],
    steps: [],
  };
}

describe("ScheduleTriggerManager", () => {
  let projectDir: string;
  let manager: ScheduleTriggerManager;
  let enqueuedRuns: WorkflowRunTrigger[];
  let startNextCount: number;
  let isStopping: boolean;

  function makeManager(isDefaultScopeRuntime = true): ScheduleTriggerManager {
    const store = new WorkflowRunStore(projectDir);
    return new ScheduleTriggerManager(
      store,
      () => isStopping,
      (_definition, _trigger, run) => {
        enqueuedRuns.push(run);
      },
      () => {
        startNextCount += 1;
      },
      undefined,
      () => isDefaultScopeRuntime,
    );
  }

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-schedule-triggers-"));
    enqueuedRuns = [];
    startNextCount = 0;
    isStopping = false;
    manager = makeManager();
  });

  afterEach(() => {
    manager.clearAll();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("queues scheduled runs with the configured trigger event name", async () => {
    const trigger: WorkflowTrigger = {
      event: "automation.fixture.scheduled",
      cooldownMs: 0,
      intervalMs: 60_000,
      payload: { scopeId: "global" },
    };
    const definition = makeDefinition("fixture", trigger);

    manager.scheduleNextFire("fixture:0", definition, trigger, Date.now() + 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(enqueuedRuns).toHaveLength(1);
    expect(enqueuedRuns[0]?.event).toBe("automation.fixture.scheduled");
    expect(enqueuedRuns[0]?.payload.scopeId).toBe("global");
    expect(enqueuedRuns[0]?.payload.scheduledAt).toEqual(expect.any(String));
    expect(startNextCount).toBe(1);
  });

  it("does not install default-scope schedules in non-default runtimes", () => {
    manager.clearAll();
    manager = makeManager(false);
    const trigger: WorkflowTrigger = {
      event: "automation.global.scheduled",
      cooldownMs: 0,
      intervalMs: 60_000,
      runOn: "default-scope",
    };

    manager.setup([makeDefinition("global-review", trigger)]);

    const timers = (manager as unknown as { timers: Map<string, unknown> }).timers;
    expect(timers.size).toBe(0);
  });

  it("installs default-scope schedules in the default runtime", () => {
    const trigger: WorkflowTrigger = {
      event: "automation.global.scheduled",
      cooldownMs: 0,
      intervalMs: 60_000,
      runOn: "default-scope",
    };

    manager.setup([makeDefinition("global-review", trigger)]);

    const timers = (manager as unknown as { timers: Map<string, unknown> }).timers;
    expect(timers.size).toBe(1);
  });

  it("clears stale schedule state when a workflow is disabled", () => {
    const store = new WorkflowRunStore(projectDir);
    store.setWorkflowNextScheduledAt(
      "global-review",
      new Date(Date.now() + 60_000).toISOString(),
    );
    const definition = makeDefinition("global-review", {
      event: "automation.global.scheduled",
      cooldownMs: 0,
      intervalMs: 60_000,
    });
    definition.enabled = false;

    manager.setup([definition]);

    expect(
      store.readState().workflows[definition.name]?.nextScheduledAt,
    ).toBeUndefined();
  });
});
