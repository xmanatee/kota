/**
 * Focused tests for the eval-harness project-scoped module event.
 *
 * The cross-cutting invariant — every module event picks an explicit scope —
 * is enforced at construction time by the helper signatures and at runtime
 * by `EventBus.emit` (see `src/core/events/module-event.test.ts`). This file
 * pins the eval-harness contract: the aggregate score event is declared as
 * project-scoped, raw-bus emits without `projectId` fail loudly, and routing
 * through a `ProjectScopedEventBus` injects the wrapper's id.
 */

import { describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import {
  type EvalHarnessSetCompletedPayload,
  evalHarnessSetCompleted,
} from "./events.js";

const SAMPLE: EvalHarnessSetCompletedPayload = {
  fixtureCount: 1,
  repeatCount: 3,
  passAtK: 0.9,
  passHatK: 0.7,
  hostClass: "test",
  runArtifactBaseDir: "/tmp/eval-runs/abc",
  startedAt: "2026-05-08T00:00:00.000Z",
  completedAt: "2026-05-08T00:01:00.000Z",
};

describe("evalHarnessSetCompleted", () => {
  it("is project-scoped and prepends projectId to the declared field set", () => {
    expect(evalHarnessSetCompleted.scope).toBe("project");
    expect(evalHarnessSetCompleted.fields[0]).toBe("projectId");
    expect(evalHarnessSetCompleted.fields).toEqual([
      "projectId",
      "fixtureCount",
      "repeatCount",
      "passAtK",
      "passHatK",
      "hostClass",
      "runArtifactBaseDir",
      "startedAt",
      "completedAt",
    ]);
  });

  it("EventBus.emit rejects payloads without projectId", () => {
    const bus = new EventBus();
    // Cast bypasses the typed overload so we can exercise the runtime guard
    // with a payload that genuinely omits projectId.
    expect(() =>
      bus.emit(evalHarnessSetCompleted, SAMPLE as unknown as never),
    ).toThrow(/project-scoped/);
  });

  it("ProjectScopedEventBus.emit injects projectId and routes to underlying subscribers", () => {
    const bus = new EventBus();
    const pbus = new ProjectScopedEventBus(bus, "test-project");
    const received: { projectId: string; fixtureCount: number }[] = [];
    bus.on(evalHarnessSetCompleted, (payload) =>
      received.push({
        projectId: payload.projectId,
        fixtureCount: payload.fixtureCount,
      }),
    );

    pbus.emit(evalHarnessSetCompleted, SAMPLE);

    expect(received).toEqual([
      { projectId: "test-project", fixtureCount: 1 },
    ]);
  });

  it("ProjectScopedEventBus.on filters subscribers to the wrapper's project", () => {
    const bus = new EventBus();
    const pbusA = new ProjectScopedEventBus(bus, "project-a");
    const pbusB = new ProjectScopedEventBus(bus, "project-b");
    const aReceived: number[] = [];
    const bReceived: number[] = [];
    pbusA.on(evalHarnessSetCompleted, (payload) =>
      aReceived.push(payload.fixtureCount),
    );
    pbusB.on(evalHarnessSetCompleted, (payload) =>
      bReceived.push(payload.fixtureCount),
    );

    pbusA.emit(evalHarnessSetCompleted, SAMPLE);
    pbusB.emit(evalHarnessSetCompleted, { ...SAMPLE, fixtureCount: 7 });

    expect(aReceived).toEqual([1]);
    expect(bReceived).toEqual([7]);
  });
});
