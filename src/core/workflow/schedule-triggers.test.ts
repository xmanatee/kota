import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRuntimeSummary } from "./runtime-state-types.js";
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
    repository: "none",
    definitionPath: `test/${name}.ts`,
    moduleRoot: process.cwd(),
    tags: [],
    triggers: [trigger],
    steps: [],
  };
}

describe("ScheduleTriggerManager", () => {
  let workspaceRoot: string;
  let manager: ScheduleTriggerManager;
  let enqueuedRuns: WorkflowRunTrigger[];
  let startNextCount: number;
  let isStopping: boolean;
  let summary: WorkflowRuntimeSummary;

  function makeManager(isDefaultScopeRuntime = true): ScheduleTriggerManager {
    return new ScheduleTriggerManager(
      () => summary,
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
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-schedule-triggers-"));
    enqueuedRuns = [];
    startNextCount = 0;
    isStopping = false;
    summary = { completedRuns: 0, workflows: {} };
    manager = makeManager();
  });

  afterEach(() => {
    manager.clearAll();
    vi.useRealTimers();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it.each([
    {
      timezone: "Europe/London", schedule: "30 1 * * *",
      start: "2026-03-29T00:00:00Z",
      fires: ["2026-03-30T00:30:00.000Z", "2026-03-31T00:30:00.000Z"],
      next: "2026-04-01T00:30:00.000Z",
    },
    {
      timezone: "America/New_York", schedule: "45 1 * * *",
      start: "2026-11-01T05:00:00Z",
      fires: ["2026-11-01T05:45:00.000Z", "2026-11-01T06:45:00.000Z"],
      next: "2026-11-02T06:45:00.000Z",
    },
  ])("sets up and re-arms across transitions in $timezone alongside unrelated work", ({
    timezone, schedule, start, fires, next,
  }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(start));
    const definitions = [
      makeDefinition("local", { event: "local.tick", cooldownMs: 0, schedule, timezone }),
      makeDefinition("unrelated", { event: "utc.tick", cooldownMs: 0, schedule: "*/30 * * * *" }),
    ];
    manager.setup(definitions);
    expect(manager.nextScheduledAt().get("local")).toBe(fires[0]);
    expect(enqueuedRuns).toHaveLength(0);

    for (const fire of fires) {
      vi.advanceTimersByTime(Date.parse(fire) - Date.now());
      expect(enqueuedRuns.filter((run) => run.event === "local.tick").at(-1)?.payload.scheduledAt)
        .toBe(fire);
      expect(Date.parse(manager.nextScheduledAt().get("local")!)).toBeGreaterThan(Date.now());
      // Recreate schedule state as on reload, including between repeated hours.
      manager.clearAll();
      manager.setup(definitions);
      expect(Date.parse(manager.nextScheduledAt().get("local")!)).toBeGreaterThan(Date.now());
    }
    expect(enqueuedRuns.filter((run) => run.event === "local.tick").map((run) => run.payload.scheduledAt))
      .toEqual(fires);
    expect(enqueuedRuns.filter((run) => run.event === "utc.tick")).toHaveLength(
      Math.floor((Date.now() - Date.parse(start)) / (30 * 60_000)),
    );
    expect(startNextCount).toBe(enqueuedRuns.length);
    expect(manager.nextScheduledAt().get("local")).toBe(next);
    vi.advanceTimersByTime(1);
    expect(enqueuedRuns.filter((run) => run.event === "local.tick")).toHaveLength(2);
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

    expect(manager.nextScheduledAt().get("global-review")).toBeUndefined();
  });

  it("installs default-scope schedules in the default runtime", () => {
    const trigger: WorkflowTrigger = {
      event: "automation.global.scheduled",
      cooldownMs: 0,
      intervalMs: 60_000,
      runOn: "default-scope",
    };

    manager.setup([makeDefinition("global-review", trigger)]);

    expect(manager.nextScheduledAt().get("global-review")).toEqual(expect.any(String));
  });

  it("projects only live schedule timers after a workflow is disabled", () => {
    const definition = makeDefinition("global-review", {
      event: "automation.global.scheduled",
      cooldownMs: 0,
      intervalMs: 60_000,
    });
    manager.setup([definition]);
    expect(manager.nextScheduledAt().has(definition.name)).toBe(true);
    definition.enabled = false;
    manager.reconcile([definition]);

    expect(manager.nextScheduledAt().has(definition.name)).toBe(false);
  });
});
