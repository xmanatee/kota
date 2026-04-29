import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getScheduler, initScheduler, resetScheduler } from "#core/daemon/scheduler.js";
import { resetNotificationHub } from "./notification-hub.js";
import { schedulerRoutes } from "./routes.js";

type CapturedResponse = {
  res: ServerResponse;
  status?: number;
  headers?: Record<string, string | number>;
  bodyChunks: string[];
  closeHandlers: Array<() => void>;
};

function mockRequest(): IncomingMessage {
  return {} as IncomingMessage;
}

function mockResponse(): CapturedResponse {
  const captured = {
    bodyChunks: [] as string[],
    closeHandlers: [] as Array<() => void>,
  } as CapturedResponse;
  const res = {
    writeHead: (status: number, headers?: Record<string, string | number>) => {
      captured.status = status;
      captured.headers = headers;
      return res;
    },
    setHeader: vi.fn(),
    write: (chunk: string) => {
      captured.bodyChunks.push(chunk);
      return true;
    },
    end: vi.fn((body?: string) => {
      if (typeof body === "string") captured.bodyChunks.push(body);
    }),
    on: (event: string, handler: () => void) => {
      if (event === "close") captured.closeHandlers.push(handler);
      return res;
    },
  } as unknown as ServerResponse;
  captured.res = res;
  return captured;
}

describe("scheduler routes", () => {
  beforeEach(() => {
    initScheduler("/test", null);
    resetNotificationHub();
  });

  afterEach(() => {
    resetScheduler();
    resetNotificationHub();
  });

  it("registers /api/schedules and /api/notifications GET routes", () => {
    const routes = schedulerRoutes();
    const paths = routes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toEqual(["GET /api/schedules", "GET /api/notifications"]);
  });

  it("/api/schedules returns the scheduler's pending items", () => {
    const scheduler = getScheduler();
    scheduler.add("Reminder one", new Date(Date.now() + 60_000));
    scheduler.add("Reminder two", new Date(Date.now() + 120_000));

    const route = schedulerRoutes().find((r) => r.path === "/api/schedules");
    expect(route).toBeDefined();
    const captured = mockResponse();
    route!.handler(mockRequest(), captured.res, {});

    expect(captured.status).toBe(200);
    const body = JSON.parse(captured.bodyChunks.join(""));
    expect(Array.isArray(body.schedules)).toBe(true);
    expect(body.schedules).toHaveLength(2);
    expect(body.schedules[0].description).toBe("Reminder one");
    expect(body.schedules[1].description).toBe("Reminder two");
  });

  it("/api/notifications opens an SSE stream and sends a connected event", () => {
    const route = schedulerRoutes().find((r) => r.path === "/api/notifications");
    expect(route).toBeDefined();
    const captured = mockResponse();
    route!.handler(mockRequest(), captured.res, {});

    expect(captured.status).toBe(200);
    expect(captured.headers?.["Content-Type"]).toBe("text/event-stream");
    const written = captured.bodyChunks.join("");
    expect(written).toContain("event: connected");
    expect(written).toContain("Listening for notifications");
  });

  it("/api/notifications emits due reminders before the connected event", () => {
    const scheduler = getScheduler();
    scheduler.add("Already due", new Date(Date.now() - 60_000));

    const route = schedulerRoutes().find((r) => r.path === "/api/notifications");
    const captured = mockResponse();
    route!.handler(mockRequest(), captured.res, {});

    const written = captured.bodyChunks.join("");
    expect(written).toContain("event: notification");
    expect(written).toContain("Already due");
    expect(written).toContain("\"type\":\"reminder\"");
  });
});
