import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initEventBus } from "#core/events/event-bus.js";
import { defineDaemonWideModuleEvent } from "#core/events/module-event.js";
import { legacyEffect } from "#core/tools/effect.js";
import { executeTool } from "#core/tools/index.js";
import { resetModuleContextTestState } from "./module-context.test-helpers.js";
import { ModuleLoader } from "./module-loader.js";
import type { ModuleContext } from "./module-types.js";

beforeEach(() => {
  resetModuleContextTestState();
  vi.restoreAllMocks();
});

afterEach(resetModuleContextTestState);

function runtimeLoader(bus = initEventBus()): ModuleLoader {
  const loader = new ModuleLoader({});
  loader.setBus(bus);
  return loader;
}

describe("ModuleContext.events", () => {
  it("provides emit method", async () => {
    const onLoad = vi.fn();
    const loader = runtimeLoader();
    await loader.load({ name: "events-test", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    expect(typeof ctx.events.emit).toBe("function");
  });

  it("rejects event operations when the bus is not connected", async () => {
    const onLoad = vi.fn();
    const loader = new ModuleLoader({}, false, { mode: "commands" });
    await loader.load({
      name: "no-bus",
      commands: (ctx) => {
        onLoad(ctx);
        return [];
      },
    });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    expect(() => ctx.events.emitExternal("test.event", { value: 1 })).toThrow(
      /requires a bound runtime EventBus/,
    );
  });

  it("emits external events to the bus", async () => {
    const bus = initEventBus();
    const received: unknown[] = [];
    bus.on("custom.event", (payload) => received.push(payload));

    const onLoad = vi.fn();
    const loader = runtimeLoader(bus);
    await loader.load({ name: "emitter", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    ctx.events.emitExternal("custom.event", { key: "value" });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ key: "value" });
  });

  it("emits typed module-declared events to the bus", async () => {
    const bus = initEventBus();
    const received: unknown[] = [];
    bus.on("module-event-test.fired", (payload) => received.push(payload));

    const onLoad = vi.fn();
    const loader = runtimeLoader(bus);
    const fired = defineDaemonWideModuleEvent<{ value: number }>(
      "module-event-test.fired",
      ["value"],
    );
    await loader.load({
      name: "module-event-test",
      events: [fired],
      onLoad,
    });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    ctx.events.emit(fired, { value: 42 });

    expect(received).toEqual([{ value: 42 }]);
  });

  it("tool runner can use ctx.events.emitExternal via closure", async () => {
    const bus = initEventBus();
    const emitted: unknown[] = [];
    bus.on("tool.ran", (payload) => emitted.push(payload));

    const loader = runtimeLoader(bus);
    await loader.load({
      name: "event-tool-mod",
      tools: (ctx) => [{
        tool: {
          name: "event_emitter_tool",
          description: "Emits an event",
          input_schema: { type: "object", properties: {} },
        },
        runner: async () => {
          ctx.events.emitExternal("tool.ran", { tool: "event_emitter_tool" });
          return { content: "emitted" };
        },
        effect: legacyEffect({ risk: "safe", kind: "discovery" }),
      }],
    });

    const result = await executeTool("event_emitter_tool", {});
    expect(result.content).toBe("emitted");
    expect(emitted).toEqual([{ tool: "event_emitter_tool" }]);
  });
});

describe("ModuleContext.createSession", () => {
  it("throws when no session factory is set", async () => {
    const onLoad = vi.fn();
    const loader = runtimeLoader();
    await loader.load({ name: "no-factory", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    expect(() => ctx.createSession()).toThrow("Session factory not available");
  });

  it("creates session when factory is set", async () => {
    const mockSession = {
      send: vi.fn(async () => "response from session"),
      close: vi.fn(),
    };
    const factory = vi.fn(() => mockSession);

    const onLoad = vi.fn();
    const loader = runtimeLoader();
    loader.setSessionFactory(factory);
    await loader.load({ name: "with-factory", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    const session = ctx.createSession({ label: "test-session" });

    expect(factory).toHaveBeenCalledWith({ label: "test-session" });
    expect(session).toBe(mockSession);
  });

  it("uses a host session factory installed after module load", async () => {
    const onLoad = vi.fn();
    const loader = runtimeLoader();
    await loader.load({ name: "host-factory", onLoad });
    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    const session = {
      send: vi.fn(async () => "host response"),
      close: vi.fn(),
    };

    loader.setSessionFactory(() => session);

    expect(ctx.createSession()).toBe(session);
  });

  it("passes default empty options when none provided", async () => {
    const factory = vi.fn(() => ({
      send: async () => "",
      close: () => {},
    }));

    const onLoad = vi.fn();
    const loader = runtimeLoader();
    loader.setSessionFactory(factory);
    await loader.load({ name: "default-opts", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    ctx.createSession();

    expect(factory).toHaveBeenCalledWith({});
  });

  it("session send and close work through the proxy", async () => {
    const sendFn = vi.fn(async (prompt: string) => `echo: ${prompt}`);
    const closeFn = vi.fn();
    const factory = vi.fn(() => ({ send: sendFn, close: closeFn }));

    const onLoad = vi.fn();
    const loader = runtimeLoader();
    loader.setSessionFactory(factory);
    await loader.load({ name: "session-proxy", onLoad });

    const ctx: ModuleContext = onLoad.mock.calls[0][0];
    const session = ctx.createSession();

    expect(await session.send("hello")).toBe("echo: hello");
    expect(sendFn).toHaveBeenCalledWith("hello");

    session.close();
    expect(closeFn).toHaveBeenCalled();
  });

  it("tool runner can create sessions via closure", async () => {
    const factory = vi.fn(() => ({
      send: async () => "sub-agent says hi",
      close: () => {},
    }));

    const loader = runtimeLoader();
    loader.setSessionFactory(factory);
    await loader.load({
      name: "session-tool-mod",
      tools: (ctx) => [{
        tool: {
          name: "spawn_session_tool",
          description: "Spawns a sub-session",
          input_schema: { type: "object", properties: {} },
        },
        runner: async () => {
          const session = ctx.createSession({ label: "sub-task" });
          const result = await session.send("do something");
          session.close();
          return { content: result };
        },
        effect: legacyEffect({ risk: "safe", kind: "discovery" }),
      }],
    });

    const result = await executeTool("spawn_session_tool", {});
    expect(result.content).toBe("sub-agent says hi");
    expect(factory).toHaveBeenCalledWith({ label: "sub-task" });
  });
});
