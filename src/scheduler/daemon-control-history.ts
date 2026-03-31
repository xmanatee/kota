import type { IncomingMessage, ServerResponse } from "node:http";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { jsonResponse } from "./daemon-control-utils.js";

export function handleListHistory(
  handle: DaemonControlHandle,
  res: ServerResponse,
  url: URL,
): void {
  const search = url.searchParams.get("search") ?? undefined;
  const rawLimit = url.searchParams.has("limit") ? Number.parseInt(url.searchParams.get("limit")!, 10) : 20;
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 1000);
  jsonResponse(res, 200, { conversations: handle.listHistory(search, limit) });
}

export function handleGetHistory(
  handle: DaemonControlHandle,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  const data = handle.getHistory(params.id);
  if (!data) {
    jsonResponse(res, 404, { error: "Conversation not found" });
    return;
  }
  jsonResponse(res, 200, data);
}

export function handleDeleteHistory(
  handle: DaemonControlHandle,
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  const deleted = handle.deleteHistory(params.id);
  if (!deleted) {
    jsonResponse(res, 404, { error: "Conversation not found" });
    return;
  }
  res.writeHead(204);
  res.end();
}
