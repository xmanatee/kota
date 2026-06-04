/**
 * Focused two-scope isolation test for the scope primitives.
 *
 * Proves the typed surface:
 *  - `defineProjectScopedModuleEvent` declares the runtime fields list with
 *    `scopeId` first and compatibility `projectId` second so workflow trigger
 *    validation can reference either spelling.
 *  - Two `ProjectScopedEventBus` views over one underlying `EventBus` deliver
 *    events only to handlers attached to the same scope view.
 *  - A cross-scope subscriber on the raw bus still sees every emit and can
 *    distinguish payloads by `scopeId`.
 */

import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus.js";
import {
  defineProjectScopedModuleEvent,
  ProjectScopedEventBus,
  type ProjectScopedPayload,
} from "./project-scope.js";

describe("defineProjectScopedModuleEvent", () => {
  it("prepends scopeId and projectId to the declared field list", () => {
    const decl = defineProjectScopedModuleEvent<{ taskId: string }>(
      "queue.shape.changed",
      ["taskId"],
    );
    expect(decl.name).toBe("queue.shape.changed");
    expect(decl.fields).toEqual(["scopeId", "projectId", "taskId"]);
  });

  it("never duplicates scope fields when the caller did not include them", () => {
    const decl = defineProjectScopedModuleEvent<{ a: string; b: number }>(
      "scoped.example",
      ["a", "b"],
    );
    expect(decl.fields).toEqual(["scopeId", "projectId", "a", "b"]);
  });
});

describe("ProjectScopedEventBus isolation", () => {
  it("delivers each emit only to subscribers of the matching scope view", () => {
    const bus = new EventBus();
    const projectA = new ProjectScopedEventBus(bus, "project-a");
    const projectB = new ProjectScopedEventBus(bus, "project-b");

    const decl = defineProjectScopedModuleEvent<{ runId: string }>(
      "isolation.example",
      ["runId"],
    );

    const handlerA = vi.fn();
    const handlerB = vi.fn();
    projectA.on(decl, handlerA);
    projectB.on(decl, handlerB);

    projectA.emit(decl, { runId: "run-1" });
    projectB.emit(decl, { runId: "run-2" });

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerA).toHaveBeenCalledWith({
      scopeId: "project-a",
      projectId: "project-a",
      runId: "run-1",
    });
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledWith({
      scopeId: "project-b",
      projectId: "project-b",
      runId: "run-2",
    });
  });

  it("injects scopeId and projectId on emit so cross-scope listeners can filter explicitly", () => {
    const bus = new EventBus();
    const projectA = new ProjectScopedEventBus(bus, "project-a");
    const projectB = new ProjectScopedEventBus(bus, "project-b");

    const decl = defineProjectScopedModuleEvent<{ runId: string }>(
      "cross.project.example",
      ["runId"],
    );

    const seen: ProjectScopedPayload<{ runId: string }>[] = [];
    bus.on(decl, (payload) => {
      seen.push(payload);
    });

    projectA.emit(decl, { runId: "a-1" });
    projectB.emit(decl, { runId: "b-1" });
    projectA.emit(decl, { runId: "a-2" });

    expect(seen).toEqual([
      { scopeId: "project-a", projectId: "project-a", runId: "a-1" },
      { scopeId: "project-b", projectId: "project-b", runId: "b-1" },
      { scopeId: "project-a", projectId: "project-a", runId: "a-2" },
    ]);

    const onlyA = seen.filter((p) => p.scopeId === "project-a");
    expect(onlyA.map((p) => p.runId)).toEqual(["a-1", "a-2"]);
  });

  it("unsubscribe stops further deliveries to that view's handler", () => {
    const bus = new EventBus();
    const projectA = new ProjectScopedEventBus(bus, "project-a");
    const decl = defineProjectScopedModuleEvent<{ runId: string }>(
      "unsubscribe.example",
      ["runId"],
    );

    const handler = vi.fn();
    const unsubscribe = projectA.on(decl, handler);

    projectA.emit(decl, { runId: "first" });
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    projectA.emit(decl, { runId: "second" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("exposes the scope id, compatibility project id, and underlying bus", () => {
    const bus = new EventBus();
    const view = new ProjectScopedEventBus(bus, "project-a");
    expect(view.getScopeId()).toBe("project-a");
    expect(view.getProjectId()).toBe("project-a");
    expect(view.getUnderlying()).toBe(bus);
  });

  it("rejects conflicting explicit selectors on dynamic emits", () => {
    const bus = new EventBus();
    const view = new ProjectScopedEventBus(bus, "project-a");
    expect(() =>
      view.emitDynamic("conflict.example", {
        scopeId: "project-a",
        projectId: "project-b",
      }),
    ).toThrow(/Conflicting scope selectors/);
  });
});
