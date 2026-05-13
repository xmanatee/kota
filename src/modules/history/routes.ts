import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { getHistoryProvider } from "#core/modules/provider-registry.js";
import type {
  ConversationData,
  ConversationRecord,
  HistoryProvider,
} from "#core/modules/provider-types.js";
import {
  type DaemonTransport,
  getDaemonTransport,
} from "#core/server/daemon-transport.js";
import { jsonResponse } from "#core/server/session-pool.js";
import {
  createHistoryProjectStores,
  type HistoryProjectStores,
} from "./project-scope.js";

function resolveScopedProvider(
  res: ServerResponse,
  url: URL,
  projectStores: HistoryProjectStores | undefined,
): HistoryProvider | null {
  if (!projectStores) return getHistoryProvider();
  const resolved = projectStores.resolve(url.searchParams.get("projectId"));
  if (!resolved.ok) {
    jsonResponse(res, 404, resolved.error);
    return null;
  }
  return resolved.store;
}

function listHistoryLocal(
  res: ServerResponse,
  url: URL,
  projectStores?: HistoryProjectStores,
): { conversations: ConversationRecord[] } | null {
  const provider = resolveScopedProvider(res, url, projectStores);
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
  return { conversations: provider.list({ search, limit, cwd, source }) };
}

function loadHistoryLocal(
  res: ServerResponse,
  url: URL,
  id: string,
  projectStores?: HistoryProjectStores,
): ConversationData | null {
  const provider = resolveScopedProvider(res, url, projectStores);
  if (!provider) return null;
  return provider.load(id) ?? null;
}

function removeHistoryLocal(
  res: ServerResponse,
  url: URL,
  id: string,
  projectStores?: HistoryProjectStores,
): boolean | null {
  const provider = resolveScopedProvider(res, url, projectStores);
  if (!provider) return null;
  return provider.remove(id);
}

export async function handleListHistory(
  res: ServerResponse,
  url: URL,
  link: DaemonTransport | null = null,
  projectStores?: HistoryProjectStores,
): Promise<void> {
  if (link) {
    const params = new URLSearchParams();
    const search = url.searchParams.get("search");
    if (search != null) params.set("search", search);
    if (url.searchParams.has("limit")) params.set("limit", url.searchParams.get("limit")!);
    const cwd = url.searchParams.get("cwd");
    if (cwd != null) params.set("cwd", cwd);
    const sourceParam = url.searchParams.get("source") ?? undefined;
    if (sourceParam === "user" || sourceParam === "action") params.set("source", sourceParam);
    const projectId = url.searchParams.get("projectId");
    if (projectId != null) params.set("projectId", projectId);
    const qs = params.toString();
    const result = await link.request<{ conversations: ConversationRecord[] }>(
      "GET",
      `/history${qs ? `?${qs}` : ""}`,
    );
    if (result) {
      jsonResponse(res, 200, result);
      return;
    }
  }

  const result = listHistoryLocal(res, url, projectStores);
  if (!result) return;
  jsonResponse(res, 200, result);
}

export async function handleGetHistory(
  res: ServerResponse,
  conversationId: string,
  url: URL,
  link: DaemonTransport | null = null,
  projectStores?: HistoryProjectStores,
): Promise<void> {
  const projectQuery = buildProjectQuery(url);
  if (link) {
    const data = await link.request<ConversationData>(
      "GET",
      `/history/${encodeURIComponent(conversationId)}${projectQuery}`,
    );
    if (data !== null) {
      jsonResponse(res, 200, data);
      return;
    }
    // null may mean daemon returned 404 or is unreachable — fall through to local
  }

  const data = loadHistoryLocal(res, url, conversationId, projectStores);
  if (data) {
    jsonResponse(res, 200, data);
  } else if (!res.headersSent) {
    jsonResponse(res, 404, { error: "Conversation not found" });
  }
}

export async function handleSearchHistory(
  req: IncomingMessage,
  res: ServerResponse,
  projectStores?: HistoryProjectStores,
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
    const provider = resolveScopedProvider(res, url, projectStores);
    if (!provider) return;
    if (semantic && !provider.supportsSemanticSearch()) {
      jsonResponse(res, 200, { ok: false, reason: "semantic_unavailable" });
      return;
    }
    const conversations = semantic
      ? await provider.semanticSearch(query, limit, { cwd, source })
      : provider.list({ search: query, limit, cwd, source });
    jsonResponse(res, 200, { ok: true, conversations });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleDeleteHistory(
  _req: IncomingMessage,
  res: ServerResponse,
  conversationId: string,
  url: URL,
  link: DaemonTransport | null = null,
  projectStores?: HistoryProjectStores,
): Promise<void> {
  const projectQuery = buildProjectQuery(url);
  if (link) {
    let resp: Response | null = null;
    try {
      resp = await link.fetchRaw(
        `/history/${encodeURIComponent(conversationId)}${projectQuery}`,
        { method: "DELETE" },
      );
    } catch {
      resp = null;
    }
    if (resp?.ok) {
      res.writeHead(204);
      res.end();
      return;
    }
    // 404 or daemon unreachable; fall through to local
  }

  const removed = removeHistoryLocal(res, url, conversationId, projectStores);
  if (removed) {
    res.writeHead(204);
    res.end();
  } else if (!res.headersSent) {
    jsonResponse(res, 404, { error: "Conversation not found" });
  }
}


export function historyRoutes(
  projectStores = createHistoryProjectStores(process.cwd(), () =>
    getHistoryProvider(),
  ),
): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/history",
      handler: (req, res) => {
        const url = new URL(req.url!, `http://localhost`);
        return handleListHistory(res, url, getDaemonTransport(), projectStores);
      },
    },
    {
      method: "GET",
      path: "/api/history/search",
      handler: (req, res) => handleSearchHistory(req, res, projectStores),
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
          getDaemonTransport(),
          projectStores,
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
          getDaemonTransport(),
          projectStores,
        );
      },
    },
  ];
}

function handleListHistoryControl(
  req: IncomingMessage,
  res: ServerResponse,
  projectStores: HistoryProjectStores,
): void {
  const url = new URL(req.url ?? "/history", "http://127.0.0.1");
  const result = listHistoryLocal(res, url, projectStores);
  if (!result) return;
  jsonResponse(res, 200, result);
}

async function handleReindexHistoryControl(
  req: IncomingMessage,
  res: ServerResponse,
  projectStores: HistoryProjectStores,
): Promise<void> {
  const url = new URL(req.url ?? "/history/reindex", "http://127.0.0.1");
  try {
    const provider = resolveScopedProvider(res, url, projectStores);
    if (!provider) return;
    const result = await provider.reindex();
    jsonResponse(res, 200, result);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

function handleGetHistoryControl(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  projectStores: HistoryProjectStores,
): void {
  const url = new URL(req.url ?? "/history", "http://127.0.0.1");
  const data = loadHistoryLocal(res, url, params.id, projectStores);
  if (!data) {
    if (!res.headersSent) {
      jsonResponse(res, 404, { error: "Conversation not found" });
    }
    return;
  }
  jsonResponse(res, 200, data);
}

function handleDeleteHistoryControl(
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  projectStores: HistoryProjectStores,
): void {
  const url = new URL(req.url ?? "/history", "http://127.0.0.1");
  const removed = removeHistoryLocal(res, url, params.id, projectStores);
  if (!removed) {
    if (res.headersSent) return;
    jsonResponse(res, 404, { error: "Conversation not found" });
    return;
  }
  jsonResponse(res, 200, { deleted: params.id });
}

function buildProjectQuery(url: URL): string {
  const projectId = url.searchParams.get("projectId");
  if (projectId === null) return "";
  const params = new URLSearchParams();
  params.set("projectId", projectId);
  return `?${params.toString()}`;
}

export function historyControlRoutes(
  projectStores = createHistoryProjectStores(process.cwd(), () =>
    getHistoryProvider(),
  ),
): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/history",
      capabilityScope: "read",
      handler: (req, res) => handleListHistoryControl(req, res, projectStores),
    },
    {
      method: "POST",
      path: "/history/reindex",
      capabilityScope: "control",
      handler: (req, res) =>
        handleReindexHistoryControl(req, res, projectStores),
    },
    {
      method: "GET",
      path: "/history/:id",
      capabilityScope: "read",
      handler: (req, res, params) =>
        handleGetHistoryControl(req, res, params, projectStores),
    },
    {
      method: "DELETE",
      path: "/history/:id",
      capabilityScope: "control",
      handler: (req, res, params) =>
        handleDeleteHistoryControl(req, res, params, projectStores),
    },
  ];
}
