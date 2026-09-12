import { expect, it, vi } from "vitest";
import { defineDaemonWideModuleEvent } from "#core/events/module-event.js";
import { readOnlyLocalEffect } from "#core/tools/effect.js";
import { executeTool } from "#core/tools/index.js";
import { createModuleLoader } from "./module-context.test-helpers.js";

it("delivers typed and external events from a context-bound tool to module subscribers", async () => {
  const loader = createModuleLoader({});
  const received = vi.fn();
  const fired = defineDaemonWideModuleEvent<{ value: number }>("module-event-test.fired", [
    "value",
  ]);
  await loader.load({
    name: "event-consumer",
    events: [fired],
    onLoad: (ctx) => {
      ctx.events.subscribe(fired, received);
      ctx.events.subscribeExternal("tool.ran", received);
    },
  });
  await loader.load({
    name: "event-producer",
    tools: (ctx) => [
      {
        tool: {
          name: "event_emitter_tool",
          description: "Emit events",
          input_schema: { type: "object", properties: {} },
        },
        runner: async () => {
          ctx.events.emit(fired, { value: 42 });
          ctx.events.emitExternal("tool.ran", { tool: "event_emitter_tool" });
          return { content: "emitted" };
        },
        effect: readOnlyLocalEffect(),
      },
    ],
  });
  expect((await executeTool("event_emitter_tool", {})).content).toBe("emitted");
  expect(received.mock.calls.map(([payload]) => payload)).toEqual([
    { value: 42 },
    { tool: "event_emitter_tool" },
  ]);
});

it("resolves the current host session factory from a retained tool context and forwards options and results", async () => {
  const loader = createModuleLoader({});
  const session = { send: vi.fn(async (prompt: string) => `echo: ${prompt}`), close: vi.fn() };
  const factory = vi.fn(() => session);
  await loader.load({
    name: "session-tool-mod",
    tools: (ctx) => [
      {
        tool: {
          name: "spawn_session_tool",
          description: "Spawn session",
          input_schema: { type: "object", properties: {} },
        },
        runner: async (input) => {
          const child = ctx.createSession(
            input.label === undefined ? undefined : { label: String(input.label) },
          );
          try {
            return { content: await child.send("hello") };
          } finally {
            child.close();
          }
        },
        effect: readOnlyLocalEffect(),
      },
    ],
  });
  expect(await executeTool("spawn_session_tool", {})).toMatchObject({
    is_error: true,
    content: expect.stringContaining("Session factory not available"),
  });
  loader.setSessionFactory(factory);
  expect((await executeTool("spawn_session_tool", {})).content).toBe("echo: hello");
  expect(factory).toHaveBeenLastCalledWith({});
  expect((await executeTool("spawn_session_tool", { label: "sub-task" })).content).toBe(
    "echo: hello",
  );
  expect(factory).toHaveBeenLastCalledWith({ label: "sub-task" });
  expect(session.send).toHaveBeenCalledWith("hello");
  expect(session.close).toHaveBeenCalledTimes(2);
});
