import type { IncomingMessage, ServerResponse } from "node:http";
import type { URL } from "node:url";
import { getHistory } from "../memory/history.js";
import { jsonResponse } from "./session-pool.js";

export function handleListHistory(res: ServerResponse, url: URL): void {
  const history = getHistory();
  const search = url.searchParams.get("search") || undefined;
  const rawLimit = url.searchParams.has("limit") ? Number.parseInt(url.searchParams.get("limit")!, 10) : 20;
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 1000);
  jsonResponse(res, 200, { conversations: history.list({ search, limit }) });
}

export function handleGetHistory(res: ServerResponse, conversationId: string): void {
  const history = getHistory();
  const data = history.load(conversationId);
  if (data) {
    jsonResponse(res, 200, data);
  } else {
    jsonResponse(res, 404, { error: "Conversation not found" });
  }
}

export function handleDeleteHistory(
  _req: IncomingMessage,
  res: ServerResponse,
  conversationId: string,
): void {
  const history = getHistory();
  if (history.remove(conversationId)) {
    res.writeHead(204);
    res.end();
  } else {
    jsonResponse(res, 404, { error: "Conversation not found" });
  }
}
