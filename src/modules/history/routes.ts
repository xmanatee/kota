import type { IncomingMessage, ServerResponse } from "node:http";
import { getHistory } from "../../memory/history.js";
import type { RouteRegistration } from "../../module-types.js";
import { DaemonControlClient } from "../../server/daemon-client.js";
import { jsonResponse } from "../../server/session-pool.js";

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

const HISTORY_ENTRY_PATTERN = /^\/api\/history\/([^/]+)$/;

export function historyRoutes(): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/history",
      handler: (req, res) => {
        const url = new URL(req.url!, `http://localhost`);
        return handleListHistory(res, url, DaemonControlClient.fromStateDir());
      },
    },
    {
      method: "GET",
      path: "/api/history/",
      pathPattern: HISTORY_ENTRY_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(HISTORY_ENTRY_PATTERN);
        return handleGetHistory(res, match![1], DaemonControlClient.fromStateDir());
      },
    },
    {
      method: "DELETE",
      path: "/api/history/",
      pathPattern: HISTORY_ENTRY_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url!, "http://localhost").pathname.match(HISTORY_ENTRY_PATTERN);
        return handleDeleteHistory(req, res, match![1], DaemonControlClient.fromStateDir());
      },
    },
  ];
}
