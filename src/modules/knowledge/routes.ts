import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { getKnowledgeProvider } from "#core/modules/provider-registry.js";
import type { KnowledgeEntry, SearchFilters } from "#core/modules/provider-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";

type KnowledgeListResponse = {
  entries: KnowledgeEntry[];
};

function parseScope(value: string | null): "project" | "global" | "all" | undefined {
  if (value === "project" || value === "global" || value === "all") return value;
  return undefined;
}

function parseListFilters(req: IncomingMessage): SearchFilters {
  const url = new URL(req.url ?? "", "http://localhost");
  const scope = parseScope(url.searchParams.get("scope")) ?? "all";
  const filters: SearchFilters = { scope };
  const tag = url.searchParams.get("tag");
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  if (tag) filters.tag = tag;
  if (type) filters.type = type;
  if (status) filters.status = status;
  return filters;
}

export function handleListKnowledge(req: IncomingMessage, res: ServerResponse): void {
  try {
    const provider = getKnowledgeProvider();
    const filters = parseListFilters(req);
    const entries = provider.list(filters);
    jsonResponse(res, 200, { entries } satisfies KnowledgeListResponse);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function handleGetKnowledge(res: ServerResponse, id: string): void {
  try {
    const provider = getKnowledgeProvider();
    const entry = provider.read(id);
    if (!entry) {
      jsonResponse(res, 404, { error: "Not found" });
      return;
    }
    jsonResponse(res, 200, entry);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleAddKnowledge(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    jsonResponse(res, 400, { error: "title is required" });
    return;
  }
  const content = typeof body.content === "string" ? body.content : "";
  const type = typeof body.type === "string" ? body.type : "note";
  const status = typeof body.status === "string" ? body.status : "active";
  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  const scope =
    body.scope === "project" || body.scope === "global" ? body.scope : undefined;
  const meta =
    body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
      ? Object.fromEntries(
          Object.entries(body.meta as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined;
  try {
    const provider = getKnowledgeProvider();
    const id = provider.create({
      title,
      content,
      type,
      tags,
      status,
      ...(scope !== undefined && { scope }),
      ...(meta !== undefined && { meta }),
    });
    jsonResponse(res, 201, { id });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleSearchKnowledge(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const query = url.searchParams.get("q") ?? "";
  const tag = url.searchParams.get("tag") ?? undefined;
  const type = url.searchParams.get("type") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const scope = parseScope(url.searchParams.get("scope"));
  const semantic = url.searchParams.get("semantic") === "true";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam
    ? Math.max(1, Number.parseInt(limitParam, 10) || 0)
    : 20;
  const filters: SearchFilters = {};
  if (tag) filters.tag = tag;
  if (type) filters.type = type;
  if (status) filters.status = status;
  if (scope) filters.scope = scope;
  try {
    const provider = getKnowledgeProvider();
    if (semantic && !provider.supportsSemanticSearch()) {
      jsonResponse(res, 200, { ok: false, reason: "semantic_unavailable" });
      return;
    }
    const entries = semantic
      ? await provider.semanticSearch(query, limit, filters)
      : provider.search(query, filters).slice(0, limit);
    jsonResponse(res, 200, { ok: true, entries });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleReindexKnowledge(res: ServerResponse): Promise<void> {
  try {
    const provider = getKnowledgeProvider();
    const result = await provider.reindex();
    jsonResponse(res, 200, result);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleUpdateKnowledge(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }
  const changes: { title?: string; content?: string; type?: string; tags?: string[] } = {};
  if (typeof body.title === "string") changes.title = body.title.trim();
  if (typeof body.content === "string") changes.content = body.content;
  if (typeof body.type === "string") changes.type = body.type.trim();
  if (Array.isArray(body.tags)) {
    changes.tags = (body.tags as unknown[]).filter((t): t is string => typeof t === "string");
  }
  try {
    const provider = getKnowledgeProvider();
    const existing = provider.read(id);
    if (!existing) {
      jsonResponse(res, 404, { error: "Not found" });
      return;
    }
    provider.update(id, changes);
    const updated = provider.read(id);
    jsonResponse(res, 200, updated);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function handleDeleteKnowledge(res: ServerResponse, id: string): void {
  try {
    const provider = getKnowledgeProvider();
    const ok = provider.delete(id);
    if (!ok) {
      jsonResponse(res, 404, { error: "Not found" });
      return;
    }
    jsonResponse(res, 200, { deleted: id });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}


export function knowledgeRoutes(): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/knowledge",
      handler: (req, res) => handleListKnowledge(req, res),
    },
    {
      method: "GET",
      path: "/api/knowledge/search",
      handler: (req, res) => handleSearchKnowledge(req, res),
    },
    {
      method: "POST",
      path: "/api/knowledge",
      handler: (req, res) => handleAddKnowledge(req, res),
    },
    {
      method: "POST",
      path: "/api/knowledge/reindex",
      handler: (_req, res) => handleReindexKnowledge(res),
    },
    {
      method: "GET",
      path: "/api/knowledge/:id",
      handler: (_req, res, params) => handleGetKnowledge(res, params.id),
    },
    {
      method: "DELETE",
      path: "/api/knowledge/:id",
      handler: (_req, res, params) => handleDeleteKnowledge(res, params.id),
    },
    {
      method: "PATCH",
      path: "/api/knowledge/:id",
      handler: (req, res, params) => handleUpdateKnowledge(req, res, params.id),
    },
  ];
}
