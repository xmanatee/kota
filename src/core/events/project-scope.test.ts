/**
 * Focused two-project isolation test for the project-scope primitives.
 *
 * Proves the typed surface introduced in slice 3a:
 *  - `defineProjectScopedModuleEvent` declares the runtime fields list with
 *    `projectId` first so workflow trigger validation can reference it.
 *  - Two `ProjectScopedEventBus` views over one underlying `EventBus` deliver
 *    events only to handlers attached to the same project view.
 *  - A cross-project subscriber on the raw bus still sees every emit and can
 *    distinguish payloads by `projectId`.
 *
 * No production emit site has migrated yet; that is the goal of slices 3b/3c.
 */

import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus.js";
import {
  defineProjectScopedModuleEvent,
  ProjectScopedEventBus,
  type ProjectScopedPayload,
} from "./project-scope.js";

describe("defineProjectScopedModuleEvent", () => {
  it("prepends projectId to the declared field list", () => {
    const decl = defineProjectScopedModuleEvent<{ taskId: string }>(
      "queue.shape.changed",
      ["taskId"],
    );
    expect(decl.name).toBe("queue.shape.changed");
    expect(decl.fields).toEqual(["projectId", "taskId"]);
  });

  it("never duplicates projectId when the caller did not include it", () => {
    const decl = defineProjectScopedModuleEvent<{ a: string; b: number }>(
      "scoped.example",
      ["a", "b"],
    );
    expect(decl.fields).toEqual(["projectId", "a", "b"]);
  });
});

describe("ProjectScopedEventBus isolation", () => {
  it("delivers each emit only to subscribers of the matching project view", () => {
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
      projectId: "project-a",
      runId: "run-1",
    });
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledWith({
      projectId: "project-b",
      runId: "run-2",
    });
  });

  it("injects projectId on emit so cross-project listeners can filter explicitly", () => {
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
      { projectId: "project-a", runId: "a-1" },
      { projectId: "project-b", runId: "b-1" },
      { projectId: "project-a", runId: "a-2" },
    ]);

    const onlyA = seen.filter((p) => p.projectId === "project-a");
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

  it("exposes the project id and underlying bus for slice 3b consumers", () => {
    const bus = new EventBus();
    const view = new ProjectScopedEventBus(bus, "project-a");
    expect(view.getProjectId()).toBe("project-a");
    expect(view.getUnderlying()).toBe(bus);
  });
});
