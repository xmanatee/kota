import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { getHistoryProvider } from "#core/modules/provider-registry.js";
import type {
  ConversationData,
  ConversationRecord,
} from "#core/modules/provider-types.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { getHistory } from "./history.js";

function listHistoryLocal(url: URL): { conversations: ConversationRecord[] } {
  const search = url.searchParams.get("search") ?? undefined;
  const cwd = url.searchParams.get("cwd") ?? undefined;
  const sourceParam = url.searchParams.get("source") ?? undefined;
  const source =
    sourceParam === "user" || sourceParam === "action" ? sourceParam : undefined;
  const rawLimit = url.searchParams.has("limit")
    ? Number.parseInt(url.searchParams.get("limit")!, 10)
    : 20;
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 1000);
  return { conversations: getHistory().list({ search, limit, cwd, source }) };
}

function loadHistoryLocal(id: string): ConversationData | null {
  return getHistory().load(id) ?? null;
}

function removeHistoryLocal(id: string): boolean {
  return getHistory().remove(id);
}

export async function handleListHistory(
  res: ServerResponse,
  url: URL,
  client: DaemonControlClient | null = null,
): Promise<void> {
  if (client) {
    const sourceParam = url.searchParams.get("source") ?? undefined;
    const source =
      sourceParam === "user" || sourceParam === "action" ? sourceParam : undefined;
    const result = await client.listHistory({
      search: url.searchParams.get("search") ?? undefined,
      limit: url.searchParams.has("limit")
        ? Number.parseInt(url.searchParams.get("limit")!, 10)
        : undefined,
      cwd: url.searchParams.get("cwd") ?? undefined,
      source,
    });
    if (result) {
      jsonResponse(res, 200, result);
      return;
    }
  }

  jsonResponse(res, 200, listHistoryLocal(url));
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

  const data = loadHistoryLocal(conversationId);
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

  if (removeHistoryLocal(conversationId)) {
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

function handleListHistoryControl(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/history", "http://127.0.0.1");
  jsonResponse(res, 200, listHistoryLocal(url));
}

async function handleReindexHistoryControl(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const provider = getHistoryProvider();
    const result = await provider.reindex();
    jsonResponse(res, 200, result);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

function handleGetHistoryControl(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  const data = loadHistoryLocal(params.id);
  if (!data) {
    jsonResponse(res, 404, { error: "Conversation not found" });
    return;
  }
  jsonResponse(res, 200, data);
}

function handleDeleteHistoryControl(
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  if (!removeHistoryLocal(params.id)) {
    jsonResponse(res, 404, { error: "Conversation not found" });
    return;
  }
  res.writeHead(204);
  res.end();
}

export function historyControlRoutes(): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/history",
      capabilityScope: "read",
      handler: handleListHistoryControl,
    },
    {
      method: "POST",
      path: "/history/reindex",
      capabilityScope: "control",
      handler: handleReindexHistoryControl,
    },
    {
      method: "GET",
      path: "/history/:id",
      capabilityScope: "read",
      handler: handleGetHistoryControl,
    },
    {
      method: "DELETE",
      path: "/history/:id",
      capabilityScope: "control",
      handler: handleDeleteHistoryControl,
    },
  ];
}
