import type { IncomingMessage, ServerResponse } from "node:http";
import type { URL } from "node:url";
import { getHistory } from "../memory/history.js";
import type { DaemonControlClient } from "./daemon-client.js";
import { jsonResponse } from "./session-pool.js";

export async function handleListHistory(
  res: ServerResponse,
  url: URL,
  client: DaemonControlClient | null = null,
): Promise<void> {
  const search = url.searchParams.get("search") ?? undefined;
  const rawLimit = url.searchParams.has("limit") ? Number.parseInt(url.searchParams.get("limit")!, 10) : 20;
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 1000);

  if (client) {
    const result = await client.listHistory(search, limit);
    if (result) {
      jsonResponse(res, 200, result);
      return;
    }
  }

  const history = getHistory();
  jsonResponse(res, 200, { conversations: history.list({ search, limit }) });
}

export async function handleGetHistory(
  res: ServerResponse,
  conversationId: string,
  client: DaemonControlClient | null = null,
): Promise<void> {
  if (client) {
    const data = await client.getHistory(conversationId);
    if (data !== null) {
      jsonResponse(res, 200, data);
      return;
    }
    // null may mean daemon returned 404 or is unreachable — fall through to local
  }

  const history = getHistory();
  const data = history.load(conversationId);
  if (data) {
    jsonResponse(res, 200, data);
  } else {
    jsonResponse(res, 404, { error: "Conversation not found" });
  }
}

export async function handleDeleteHistory(
  _req: IncomingMessage,
  res: ServerResponse,
  conversationId: string,
  client: DaemonControlClient | null = null,
): Promise<void> {
  if (client) {
    const deleted = await client.deleteHistory(conversationId);
    if (deleted) {
      res.writeHead(204);
      res.end();
      return;
    }
    // deleted=false may mean not found OR daemon unreachable; check local
  }

  const history = getHistory();
  if (history.remove(conversationId)) {
    res.writeHead(204);
    res.end();
  } else {
    jsonResponse(res, 404, { error: "Conversation not found" });
  }
}
