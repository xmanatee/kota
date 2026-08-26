import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus.js";
import {
  defineScopedModuleEvent,
  ScopedEventBus,
  type ScopedPayload,
} from "./scope.js";

describe("scope-attributed events", () => {
  it("declares one required scope identity field", () => {
    const declaration = defineScopedModuleEvent<{ taskId: string }>(
      "queue.shape.changed",
      ["taskId"],
    );

    expect(declaration.fields).toEqual(["scopeId", "taskId"]);
  });

  it("isolates subscribers by scope", () => {
    const bus = new EventBus();
    const scopeA = new ScopedEventBus(bus, "scope-a");
    const scopeB = new ScopedEventBus(bus, "scope-b");
    const event = defineScopedModuleEvent<{ runId: string }>(
      "isolation.example",
      ["runId"],
    );
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    scopeA.on(event, handlerA);
    scopeB.on(event, handlerB);

    scopeA.emit(event, { runId: "run-a" });
    scopeB.emit(event, { runId: "run-b" });

    expect(handlerA).toHaveBeenCalledWith({ scopeId: "scope-a", runId: "run-a" });
    expect(handlerB).toHaveBeenCalledWith({ scopeId: "scope-b", runId: "run-b" });
  });

  it("lets raw-bus consumers distinguish scopes by scopeId", () => {
    const bus = new EventBus();
    const event = defineScopedModuleEvent<{ runId: string }>("cross.scope.example", ["runId"]);
    const seen: ScopedPayload<{ runId: string }>[] = [];
    bus.on(event, (payload) => seen.push(payload));

    new ScopedEventBus(bus, "scope-a").emit(event, { runId: "a" });
    new ScopedEventBus(bus, "scope-b").emit(event, { runId: "b" });

    expect(seen).toEqual([
      { scopeId: "scope-a", runId: "a" },
      { scopeId: "scope-b", runId: "b" },
    ]);
  });

  it("rejects an explicit identity that conflicts with the bound scope", () => {
    const view = new ScopedEventBus(new EventBus(), "scope-a");
    expect(() =>
      view.emitDynamic("conflict.example", { scopeId: "scope-b" }),
    ).toThrow(/does not match scoped bus/);
  });
});
