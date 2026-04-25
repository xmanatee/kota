import type { IncomingMessage, ServerResponse } from "node:http";
import { getScheduler } from "#core/daemon/scheduler.js";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse, SseTransport, setCors } from "#core/server/session-pool.js";
import { getNotificationHub } from "./notification-hub.js";

function handleListSchedules(_req: IncomingMessage, res: ServerResponse): void {
  jsonResponse(res, 200, { schedules: getScheduler().pending() });
}

function handleNotifications(_req: IncomingMessage, res: ServerResponse): void {
  const hub = getNotificationHub();

  setCors(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const sse = new SseTransport(res);
  hub.addClient(sse);
  res.on("close", () => hub.removeClient(sse));
  try {
    const scheduler = getScheduler();
    for (const item of scheduler.getDue()) {
      scheduler.markFired(item.id);
      sse.send("notification", {
        type: "reminder",
        id: item.id,
        description: item.description,
        scheduledFor: item.triggerAt,
        repeat: item.repeatLabel || null,
      });
    }
  } catch (err) {
    sse.send("error", { message: (err as Error).message });
  }
  sse.send("connected", { message: "Listening for notifications" });
}

export function schedulerRoutes(): RouteRegistration[] {
  return [
    { method: "GET", path: "/api/schedules", handler: handleListSchedules },
    { method: "GET", path: "/api/notifications", handler: handleNotifications },
  ];
}
