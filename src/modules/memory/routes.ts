import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { getMemoryProvider } from "#core/modules/provider-registry.js";
import type { Memory } from "#core/modules/provider-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { MemoryProjectStores } from "./project-scope.js";

type MemoryListItem = {
  id: string;
  tags: string[];
  created: string;
  excerpt: string;
};

type MemoryListResponse = {
  entries: MemoryListItem[];
};

function toListItem(m: Memory): MemoryListItem {
  return {
    id: m.id,
    tags: m.tags,
    created: m.created,
    excerpt: m.content.slice(0, 200).replace(/\s+/g, " ").trim(),
  };
}

function resolveScopedProvider(
  req: IncomingMessage,
  res: ServerResponse,
  projectStores: MemoryProjectStores | undefined,
) {
  if (!projectStores) return getMemoryProvider();
  const url = new URL(req.url ?? "", "http://localhost");
  const resolved = projectStores.resolve(url.searchParams.get("projectId"));
  if (!resolved.ok) {
    jsonResponse(res, 404, resolved.error);
    return null;
  }
  return resolved.store;
}

export function handleListMemory(
  req: IncomingMessage,
  res: ServerResponse,
  projectStores?: MemoryProjectStores,
): void {
  try {
    const provider = resolveScopedProvider(req, res, projectStores);
    if (!provider) return;
    const all = provider.list();
    jsonResponse(res, 200, { entries: all.map(toListItem) } satisfies MemoryListResponse);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function handleGetMemory(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  projectStores?: MemoryProjectStores,
): void {
  try {
    const provider = resolveScopedProvider(req, res, projectStores);
    if (!provider) return;
    const entry = provider.list().find((m) => m.id === id) ?? null;
    if (!entry) {
      jsonResponse(res, 404, { error: "Not found" });
      return;
    }
    jsonResponse(res, 200, entry);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleAddMemory(
  req: IncomingMessage,
  res: ServerResponse,
  projectStores?: MemoryProjectStores,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    jsonResponse(res, 400, { error: "content is required" });
    return;
  }
  const tags = Array.isArray(body.tags) ? (body.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
  try {
    const provider = resolveScopedProvider(req, res, projectStores);
    if (!provider) return;
    const id = provider.save(content, tags);
    jsonResponse(res, 201, { id });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleUpdateMemory(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  projectStores?: MemoryProjectStores,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }
  const changes: { content?: string; tags?: string[] } = {};
  if (typeof body.content === "string") changes.content = body.content;
  if (Array.isArray(body.tags)) {
    changes.tags = (body.tags as unknown[]).filter((t): t is string => typeof t === "string");
  }
  try {
    const provider = resolveScopedProvider(req, res, projectStores);
    if (!provider) return;
    const existing = provider.list().find((m) => m.id === id) ?? null;
    if (!existing) {
      jsonResponse(res, 404, { error: "Not found" });
      return;
    }
    provider.update(id, changes);
    const updated = provider.list().find((m) => m.id === id) ?? null;
    jsonResponse(res, 200, updated);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function handleDeleteMemory(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  projectStores?: MemoryProjectStores,
): void {
  try {
    const provider = resolveScopedProvider(req, res, projectStores);
    if (!provider) return;
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

export async function handleSearchMemory(
  req: IncomingMessage,
  res: ServerResponse,
  projectStores?: MemoryProjectStores,
): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const query = url.searchParams.get("q") ?? "";
  const tag = url.searchParams.get("tag") ?? undefined;
  const since = url.searchParams.get("since") ?? undefined;
  const semantic = url.searchParams.get("semantic") === "true";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10) || 0) : 20;
  try {
    const provider = resolveScopedProvider(req, res, projectStores);
    if (!provider) return;
    if (semantic && !provider.supportsSemanticSearch()) {
      jsonResponse(res, 200, { ok: false, reason: "semantic_unavailable" });
      return;
    }
    const results = semantic
      ? await provider.semanticSearch(query, limit, { tag, since })
      : provider.search(query, { tag, since }).slice(0, limit);
    jsonResponse(res, 200, {
      ok: true,
      entries: results.map((m) => ({ id: m.id, created: m.created, content: m.content })),
    });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleReindexMemory(
  req: IncomingMessage,
  res: ServerResponse,
  projectStores?: MemoryProjectStores,
): Promise<void> {
  try {
    const provider = resolveScopedProvider(req, res, projectStores);
    if (!provider) return;
    const result = await provider.reindex();
    jsonResponse(res, 200, result);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}


export function memoryRoutes(projectStores: MemoryProjectStores): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/memory",
      handler: (req, res) => handleListMemory(req, res, projectStores),
    },
    {
      method: "GET",
      path: "/api/memory/search",
      handler: (req, res) => handleSearchMemory(req, res, projectStores),
    },
    {
      method: "POST",
      path: "/api/memory",
      handler: (req, res) => handleAddMemory(req, res, projectStores),
    },
    {
      method: "POST",
      path: "/api/memory/reindex",
      handler: (req, res) => handleReindexMemory(req, res, projectStores),
    },
    {
      method: "GET",
      path: "/api/memory/:id",
      handler: (req, res, params) =>
        handleGetMemory(req, res, params.id, projectStores),
    },
    {
      method: "DELETE",
      path: "/api/memory/:id",
      handler: (req, res, params) =>
        handleDeleteMemory(req, res, params.id, projectStores),
    },
    {
      method: "PATCH",
      path: "/api/memory/:id",
      handler: (req, res, params) =>
        handleUpdateMemory(req, res, params.id, projectStores),
    },
  ];
}
