import { describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import autonomyModule from "./index.js";

function publicationContext(events: ModuleRuntimeContext["events"]): ModuleRuntimeContext {
  return {
    events,
    getProvider: () => null,
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  } as unknown as ModuleRuntimeContext;
}

describe("autonomy module subscriptions", () => {
  it("does not register workflow completion mutation subscribers", () => {
    const bus = new EventBus();
    const ctx = publicationContext(makeStubEventProxy(bus));

    autonomyModule.onLoad?.(ctx);
    expect(bus.listenerCount("workflow.completed")).toBe(0);

    autonomyModule.onLoad?.(ctx);
    expect(bus.listenerCount("workflow.completed")).toBe(0);
  });
});
