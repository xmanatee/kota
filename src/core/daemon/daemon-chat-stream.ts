import type { ServerResponse } from "node:http";
import type {
  DaemonChatSession,
  DaemonChatStreamPayload,
} from "./daemon-chat-pool.js";

export function writeDaemonChatSse(
  res: ServerResponse,
  eventName: string,
  data: DaemonChatStreamPayload,
): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function publishDaemonChatSse(
  session: DaemonChatSession,
  res: ServerResponse,
  eventName: string,
  data: DaemonChatStreamPayload,
): void {
  writeDaemonChatSse(res, eventName, data);
  for (const subscriber of session.subscribers) {
    subscriber.write(eventName, data);
  }
}

export function closeDaemonChatSubscribers(session: DaemonChatSession): void {
  for (const subscriber of session.subscribers) {
    subscriber.close();
  }
  session.subscribers.clear();
}
