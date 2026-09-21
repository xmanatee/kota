import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRuntimeSummary } from "./runtime-state-types.js";
import { ScheduleTriggerManager } from "./schedule-triggers.js";
import type { WorkflowRunTrigger, WorkflowTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "./validation.js";

function makeDefinition(
  name: string,
  trigger: WorkflowTrigger,
): WorkflowDefinition {
  return validateWorkflowDefinitions([registerWorkflowDefinition(`test/${name}.ts`, {
    name,
    repository: "none",
    triggers: [trigger],
    steps: [{ id: "work", type: "code", run: () => "ok" }],
  })])[0];
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
      // Reload preserves live timers; rebuilding after restart also advances.
      manager.reconcile(definitions);
      expect(Date.parse(manager.nextScheduledAt().get("local")!)).toBeGreaterThan(Date.now());
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

  it.each([
    { before: { schedule: "0 9 * * *" }, after: { schedule: "0 10 * * *" }, next: "2026-09-21T10:00:00.000Z" },
    { before: { schedule: "0 9 * * *" }, after: { schedule: "0 9 * * *", timezone: "America/New_York" }, next: "2026-09-21T13:00:00.000Z" },
    { before: { intervalMs: 60 * 60_000 }, after: { intervalMs: 2 * 60 * 60_000 }, next: "2026-09-21T10:00:00.000Z" },
    { before: { intervalMs: 60 * 60_000 }, after: { schedule: "0 10 * * *" }, next: "2026-09-21T10:00:00.000Z" },
    { before: { schedule: "0 9 * * *" }, after: { intervalMs: 2 * 60 * 60_000 }, next: "2026-09-21T10:00:00.000Z" },
  ])("replaces changed timing $before with $after", ({ before, after, next }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T08:00:00Z"));
    summary.workflows.report = {
      lastCompletion: { runId: "previous", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), status: "success" },
    };
    const unrelated = makeDefinition("unrelated", { event: "other.tick", cooldownMs: 0, schedule: "0 9 * * *" });
    manager.setup([makeDefinition("report", { event: "report.tick", cooldownMs: 0, ...before }), unrelated]);
    vi.advanceTimersByTime(10 * 60_000);
    manager.reconcile([makeDefinition("report", { event: "report.tick", cooldownMs: 0, ...after }), unrelated]);
    expect(manager.nextScheduledAt().get("report")).toBe(next);
    vi.advanceTimersByTime(50 * 60_000);
    expect(enqueuedRuns.map((run) => run.event)).toEqual(["other.tick"]);
    vi.advanceTimersByTime(Date.parse(next) - Date.now());
    expect(enqueuedRuns.filter((run) => run.event === "report.tick").map((run) => run.payload.scheduledAt)).toEqual([next]);
    expect(Date.parse(manager.nextScheduledAt().get("report")!)).toBeGreaterThan(Date.now());
  });

  it("preserves interval progress while refreshing payload, event and definition", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T08:00:00Z"));
    const admitted: WorkflowDefinition[] = [];
    manager = new ScheduleTriggerManager(() => summary, () => false, (definition, _trigger, run) => {
      admitted.push(definition);
      enqueuedRuns.push(run);
    }, () => {});
    const original = makeDefinition("report", { event: "old.tick", cooldownMs: 0, intervalMs: 60_000, payload: { revision: "old" } });
    manager.setup([original]);
    vi.advanceTimersByTime(0);
    expect(admitted).toEqual([original]);
    vi.advanceTimersByTime(20_000);
    const revised = makeDefinition("report", { event: "new.tick", cooldownMs: 0, intervalMs: 60_000, payload: { revision: "new", flag: false, count: 0 } });
    manager.reconcile([revised]);
    expect(manager.nextScheduledAt().get("report")).toBe("2026-09-21T08:01:00.000Z");
    vi.advanceTimersByTime(40_000);
    expect(admitted).toEqual([original, revised]);
    expect(enqueuedRuns.map((run) => [run.event, run.payload.revision])).toEqual([["old.tick", "old"], ["new.tick", "new"]]);
    expect(enqueuedRuns[1].payload).toMatchObject({ flag: false, count: 0 });
    manager.reconcile([makeDefinition("report", { ...revised.triggers[0], payload: undefined })]);
    vi.advanceTimersByTime(60_000);
    expect(enqueuedRuns[2].payload).toEqual({ scheduledAt: "2026-09-21T08:02:00.000Z" });
  });

  it.each(["removed", "disabled", "event-only", "default-scope"] as const)("cancels %s schedules", (change) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T08:00:00Z"));
    manager = makeManager(false);
    const original = makeDefinition("report", { event: "report.tick", cooldownMs: 0, schedule: "0 9 * * *" });
    manager.setup([original]);
    const revised = makeDefinition("report", {
      ...original.triggers[0],
      ...(change === "event-only" ? { schedule: undefined } : {}),
      ...(change === "default-scope" ? { runOn: "default-scope" } : {}),
    });
    if (change === "disabled") revised.enabled = false;
    manager.reconcile(change === "removed" ? [] : [revised]);
    expect(manager.nextScheduledAt().size).toBe(0);
    vi.advanceTimersByTime(2 * 24 * 60 * 60_000);
    expect(enqueuedRuns).toEqual([]);
  });

  it("cannot re-arm a callback retired during admission", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T08:00:00Z"));
    const revised = makeDefinition("report", { event: "new.tick", cooldownMs: 0, schedule: "0 10 * * *" });
    manager = new ScheduleTriggerManager(() => summary, () => false, (_definition, _trigger, run) => {
      enqueuedRuns.push(run);
      manager.reconcile([revised]);
    }, () => {});
    manager.setup([makeDefinition("report", { event: "old.tick", cooldownMs: 0, schedule: "0 9 * * *" })]);
    vi.advanceTimersByTime(60 * 60_000);
    expect(manager.nextScheduledAt().get("report")).toBe("2026-09-21T10:00:00.000Z");
    vi.advanceTimersByTime(60 * 60_000);
    expect(enqueuedRuns.map((run) => run.event)).toEqual(["old.tick", "new.tick"]);
    expect(manager.nextScheduledAt().get("report")).toBe("2026-09-22T10:00:00.000Z");
    vi.advanceTimersByTime(60 * 60_000);
    expect(enqueuedRuns).toHaveLength(2);
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
