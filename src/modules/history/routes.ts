import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { getHistoryProvider } from "#core/modules/provider-registry.js";
import type {
  ConversationRecord,
  HistoryProvider,
} from "#core/modules/provider-types.js";
import { selectedScopeSelectorIdFromUrlOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse } from "#core/server/session-pool.js";
import type { HistoryDetail } from "./client.js";
import {
  HistoryDetailParameterError,
  type HistoryDetailRequest,
  parseHistoryDetailRequestFromUrl,
} from "./history-detail.js";
import { listLocalScopeHistoryRecords } from "./local-history-scan.js";
import {
  deleteHistory,
  listHistory,
  reindexHistory,
  searchHistory,
  showHistory,
} from "./operations.js";
import {
  createHistoryScopeStores,
  type HistoryScopeStores,
} from "./scope.js";

function resolveScopedProvider(
  res: ServerResponse,
  url: URL,
  scopeStores: HistoryScopeStores | undefined,
): HistoryProvider | null {
  if (!scopeStores) return getHistoryProvider();
  const selectedId = selectedScopeSelectorIdFromUrlOrErrorResponse(res, url);
  if (selectedId === null) return null;
  const resolved = scopeStores.resolve(selectedId);
  if (!resolved.ok) {
    jsonResponse(res, 404, resolved.error);
    return null;
  }
  return resolved.store;
}

function listHistoryLocal(
  res: ServerResponse,
  url: URL,
  scopeStores?: HistoryScopeStores,
): { conversations: ConversationRecord[] } | null {
  const provider = resolveScopedProvider(res, url, scopeStores);
  if (!provider) return null;
  const search = url.searchParams.get("search") ?? undefined;
  const cwd = url.searchParams.get("cwd") ?? undefined;
  const sourceParam = url.searchParams.get("source") ?? undefined;
  const source =
    sourceParam === "user" || sourceParam === "action" ? sourceParam : undefined;
  const rawLimit = url.searchParams.has("limit")
    ? Number.parseInt(url.searchParams.get("limit")!, 10)
    : 20;
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 1000);
  return listHistory(provider, { search, limit, cwd, source });
}

function loadHistoryLocal(
  res: ServerResponse,
  url: URL,
  id: string,
  request: HistoryDetailRequest,
  scopeStores?: HistoryScopeStores,
): HistoryDetail | null {
  const provider = resolveScopedProvider(res, url, scopeStores);
  if (!provider) return null;
  const result = showHistory(provider, id, request);
  return result.found ? result.detail : null;
}

function removeHistoryLocal(
  res: ServerResponse,
  url: URL,
  id: string,
  scopeStores?: HistoryScopeStores,
): boolean | null {
  const provider = resolveScopedProvider(res, url, scopeStores);
  if (!provider) return null;
  return deleteHistory(provider, id).ok;
}

export function handleListHistory(
  res: ServerResponse,
  url: URL,
  scopeStores?: HistoryScopeStores,
): void {
  const result = listHistoryLocal(res, url, scopeStores);
  if (!result) return;
  jsonResponse(res, 200, result);
}

export function handleGetHistory(
  res: ServerResponse,
  conversationId: string,
  url: URL,
  scopeStores?: HistoryScopeStores,
): void {
  const request = parseHistoryDetailRequestOrRespond(res, url);
  if (!request) return;
  const detail = loadHistoryLocal(res, url, conversationId, request, scopeStores);
  if (detail) {
    jsonResponse(res, 200, detail);
  } else if (!res.headersSent) {
    jsonResponse(res, 404, { error: "Conversation not found" });
  }
}

export async function handleSearchHistory(
  req: IncomingMessage,
  res: ServerResponse,
  scopeStores?: HistoryScopeStores,
): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const query = url.searchParams.get("q") ?? "";
  const cwd = url.searchParams.get("cwd") ?? undefined;
  const sourceParam = url.searchParams.get("source") ?? undefined;
  const source =
    sourceParam === "user" || sourceParam === "action" ? sourceParam : undefined;
  const semantic = url.searchParams.get("semantic") === "true";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam
    ? Math.max(1, Number.parseInt(limitParam, 10) || 0)
    : 20;
  try {
    const provider = resolveScopedProvider(res, url, scopeStores);
    if (!provider) return;
    jsonResponse(res, 200, await searchHistory(provider, query, {
      cwd,
      source,
      semantic,
      limit,
    }));
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function handleDeleteHistory(
  _req: IncomingMessage,
  res: ServerResponse,
  conversationId: string,
  url: URL,
  scopeStores?: HistoryScopeStores,
): void {
  const removed = removeHistoryLocal(res, url, conversationId, scopeStores);
  if (removed) {
    res.writeHead(204);
    res.end();
  } else if (!res.headersSent) {
    jsonResponse(res, 404, { error: "Conversation not found" });
  }
}


export function historyRoutes(
  scopeStores = createHistoryScopeStores(process.cwd(), () =>
    getHistoryProvider(),
  ),
): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/history",
      handler: (req, res) => {
        const url = new URL(req.url!, `http://localhost`);
        return handleListHistory(res, url, scopeStores);
      },
    },
    {
      method: "GET",
      path: "/api/history/search",
      handler: (req, res) => handleSearchHistory(req, res, scopeStores),
    },
    {
      method: "GET",
      path: "/api/history/:id",
      handler: (req, res, params) => {
        const url = new URL(req.url ?? "", "http://localhost");
        return handleGetHistory(
          res,
          params.id,
          url,
          scopeStores,
        );
      },
    },
    {
      method: "DELETE",
      path: "/api/history/:id",
      handler: (req, res, params) => {
        const url = new URL(req.url ?? "", "http://localhost");
        return handleDeleteHistory(
          req,
          res,
          params.id,
          url,
          scopeStores,
        );
      },
    },
  ];
}

function handleListHistoryControl(
  req: IncomingMessage,
  res: ServerResponse,
  scopeStores: HistoryScopeStores,
): void {
  const url = new URL(req.url ?? "/history", "http://127.0.0.1");
  const result = listHistoryLocal(res, url, scopeStores);
  if (!result) return;
  jsonResponse(res, 200, result);
}

function handleListDiscoveredScopeRecordsControl(
  req: IncomingMessage,
  res: ServerResponse,
  discoveryCwd: string,
): void {
  const url = new URL(
    req.url ?? "/history/discovered-scope-records",
    "http://127.0.0.1",
  );
  const rawLimit = url.searchParams.has("limit")
    ? Number.parseInt(url.searchParams.get("limit")!, 10)
    : undefined;
  const limit =
    rawLimit === undefined || Number.isNaN(rawLimit) || rawLimit < 1
      ? undefined
      : Math.min(rawLimit, 10_000);
  jsonResponse(res, 200, {
    conversations: listLocalScopeHistoryRecords({
      cwd: discoveryCwd,
      limit,
    }),
  });
}

async function handleReindexHistoryControl(
  req: IncomingMessage,
  res: ServerResponse,
  scopeStores: HistoryScopeStores,
): Promise<void> {
  const url = new URL(req.url ?? "/history/reindex", "http://127.0.0.1");
  try {
    const provider = resolveScopedProvider(res, url, scopeStores);
    if (!provider) return;
    jsonResponse(res, 200, await reindexHistory(provider));
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

function handleGetHistoryControl(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  scopeStores: HistoryScopeStores,
): void {
  const url = new URL(req.url ?? "/history", "http://127.0.0.1");
  const request = parseHistoryDetailRequestOrRespond(res, url);
  if (!request) return;
  const detail = loadHistoryLocal(res, url, params.id, request, scopeStores);
  if (!detail) {
    if (!res.headersSent) {
      jsonResponse(res, 404, { error: "Conversation not found" });
    }
    return;
  }
  jsonResponse(res, 200, detail);
}

function handleDeleteHistoryControl(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  scopeStores: HistoryScopeStores,
): void {
  const url = new URL(req.url ?? "/history", "http://127.0.0.1");
  const removed = removeHistoryLocal(res, url, params.id, scopeStores);
  if (!removed) {
    if (res.headersSent) return;
    jsonResponse(res, 404, { error: "Conversation not found" });
    return;
  }
  jsonResponse(res, 200, { deleted: params.id });
}

function parseHistoryDetailRequestOrRespond(
  res: ServerResponse,
  url: URL,
): HistoryDetailRequest | null {
  try {
    return parseHistoryDetailRequestFromUrl(url);
  } catch (err) {
    if (err instanceof HistoryDetailParameterError) {
      jsonResponse(res, 400, { error: err.message });
      return null;
    }
    throw err;
  }
}

export function historyControlRoutes(
  scopeStores = createHistoryScopeStores(process.cwd(), () =>
    getHistoryProvider(),
  ),
  discoveryCwd = process.cwd(),
): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/history",
      capabilityScope: "read",
      handler: (req, res) => handleListHistoryControl(req, res, scopeStores),
    },
    {
      method: "GET",
      path: "/history/discovered-scope-records",
      capabilityScope: "read",
      handler: (req, res) =>
        handleListDiscoveredScopeRecordsControl(req, res, discoveryCwd),
    },
    {
      method: "POST",
      path: "/history/reindex",
      capabilityScope: "control",
      handler: (req, res) =>
        handleReindexHistoryControl(req, res, scopeStores),
    },
    {
      method: "GET",
      path: "/history/:id",
      capabilityScope: "read",
      handler: (req, res, params) =>
        handleGetHistoryControl(req, res, params, scopeStores),
    },
    {
      method: "DELETE",
      path: "/history/:id",
      capabilityScope: "control",
      handler: (req, res, params) =>
        handleDeleteHistoryControl(req, res, params, scopeStores),
    },
  ];
}
