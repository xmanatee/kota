import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDaemonEventControlRoutes,
  SSE_HEARTBEAT_INTERVAL_MS,
  startSseHeartbeat,
  writeDaemonSseEvent,
} from "./daemon-control-event-routes.js";

describe("daemon event stream heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps an idle SSE response live until the connection closes", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const stop = startSseHeartbeat({ write });

    vi.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS * 2);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(": heartbeat\n\n");

    stop();
    vi.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS);
    expect(write).toHaveBeenCalledTimes(2);
  });
});


import { EventRingBuffer } from "./event-ring-buffer.js";
import { makeDaemonConfigReloadEvent, makeTaskChangedEvent } from "./sse-event-fixtures.integration.js";

it.each([
  { query: "scopeId=a&after=evt-1", scope: "a", replay: [2, 4], live: [7, 8] },
  { query: "scopeId=a&since=2000-01-01", scope: "a", replay: [2, 4], live: [7, 8] },
  { query: "scopeId=b&after=evt-1", scope: "b", replay: [3, 4], live: [6, 8] },
  { query: "after=evt-1", scope: null, replay: [2, 3, 4, 5], live: [6, 7, 8] },
])("shares selection for replay and live delivery: $query", async ({ query, scope, replay, live }) => {
  const buffer = new EventRingBuffer();
  buffer.push(makeTaskChangedEvent({ scopeId: "b" }));
  buffer.push(makeTaskChangedEvent({ scopeId: "a" }));
  buffer.push(makeTaskChangedEvent({ scopeId: "b" }));
  buffer.push(makeDaemonConfigReloadEvent());
  buffer.push(JSON.parse('{"type":"task.changed","payload":{"counts":{}}}'));
  const clients = new Map<ServerResponse, string | null>();
  const route = buildDaemonEventControlRoutes({ eventBuffer: buffer, sseClients: clients })
    .find(candidate => candidate.path === "/events")!;
  const req = new IncomingMessage(new Socket());
  req.url = `/events?${query}`;
  const res = new ServerResponse(req);
  // Control only the response network port; route, replay buffer and projection are real.
  const write = vi.spyOn(res, "write").mockReturnValue(true);
  const deliveredIds = () => [...write.mock.calls.map(([chunk]) => String(chunk)).join("").matchAll(/^id: (.+)$/gm)].map(match => match[1]);
  try {
    await route.handler(req, res, {});
    expect(clients.get(res)).toBe(scope);
    expect(deliveredIds()).toEqual(replay.map(id => `evt-${id}`));
    write.mockClear();
    for (const entry of [buffer.push(makeTaskChangedEvent({ scopeId: "b" })), buffer.push(makeTaskChangedEvent({ scopeId: "a" })), buffer.push(makeDaemonConfigReloadEvent())]) {
      writeDaemonSseEvent(res, entry, clients.get(res)!);
    }
    expect(deliveredIds()).toEqual(live.map(id => `evt-${id}`));
  } finally {
    res.emit("close");
    expect(clients.has(res)).toBe(false);
    req.destroy();
  }
});
