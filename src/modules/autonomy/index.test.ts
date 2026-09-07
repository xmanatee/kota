import { describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import autonomyModule from "./index.js";

function publicationContext(events: ModuleRuntimeContext["events"]): ModuleRuntimeContext {
  return {
    events,
    getProvider: () => null,
    registerProvider: () => {},
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  } as unknown as ModuleRuntimeContext;
}

describe("autonomy module subscriptions", () => {
  it("registers typed workflow health and disposition reconciliation sources", () => {
    const bus = new EventBus();
    const ctx = publicationContext(makeStubEventProxy(bus));

    autonomyModule.onLoad?.(ctx);
    expect(bus.listenerCount("workflow.completed")).toBe(2);
    expect(bus.listenerCount("module.operation.failed")).toBe(1);
    expect(bus.listenerCount("module.operation.recovered")).toBe(1);
    expect(bus.listenerCount("runtime.idle")).toBe(1);
    expect(bus.listenerCount("owner.decision.resolved")).toBe(1);
  });
});
