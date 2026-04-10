import type { IncomingMessage, ServerResponse } from "node:http";
import type { EventBus } from "../events/event-bus.js";
import { jsonResponse, readBody } from "./session-pool.js";

export async function handleEventTrigger(
  req: IncomingMessage,
  res: ServerResponse,
  eventBus: EventBus,
  eventName: string,
): Promise<void> {
  if (!eventName || eventName.length > 256) {
    jsonResponse(res, 400, { error: "Event name must be 1-256 characters" });
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = await readBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  eventBus.emit(eventName, payload);
  jsonResponse(res, 200, {
    ok: true,
    event: eventName,
    listeners: eventBus.listenerCount(eventName) + eventBus.listenerCount("*"),
  });
}
