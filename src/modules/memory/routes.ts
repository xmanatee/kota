import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteRegistration } from "#core/modules/module-types.js";
import type { Memory } from "#core/modules/provider-types.js";
import { parseWorkMemoryMetadataFromBody } from "#core/modules/work-memory-metadata.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import {
  deleteMemory,
  listMemory,
  reindexMemory,
  searchMemory,
} from "./operations.js";
import { resolveMemoryRouteProvider } from "./route-provider.js";
import type { MemoryScopeStores } from "./scope.js";

type MemoryRequestBody = Awaited<ReturnType<typeof readBody>>;

export function handleListMemory(
  req: IncomingMessage,
  res: ServerResponse,
  scopeStores?: MemoryScopeStores,
): void {
  try {
    const provider = resolveMemoryRouteProvider(req, res, scopeStores);
    if (!provider) return;
    const url = new URL(req.url ?? "", "http://localhost");
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? undefined : Number.parseInt(rawLimit, 10);
    jsonResponse(res, 200, listMemory(provider, {
      ...(limit !== undefined && Number.isFinite(limit) && { limit }),
    }));
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function handleGetMemory(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  scopeStores?: MemoryScopeStores,
): void {
  try {
    const provider = resolveMemoryRouteProvider(req, res, scopeStores);
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
  scopeStores?: MemoryScopeStores,
): Promise<void> {
  let body: MemoryRequestBody;
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
  const metadata = parseWorkMemoryMetadataFromBody(body);
  if (!metadata.ok) {
    jsonResponse(res, 400, { error: metadata.message });
    return;
  }
  try {
    const provider = resolveMemoryRouteProvider(req, res, scopeStores);
    if (!provider) return;
    const id = metadata.metadata
      ? provider.save(content, tags, metadata.metadata)
      : provider.save(content, tags);
    jsonResponse(res, 201, { id });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleUpdateMemory(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  scopeStores?: MemoryScopeStores,
): Promise<void> {
  let body: MemoryRequestBody;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }
  const changes: {
    content?: string;
    tags?: string[];
    provenance?: Memory["provenance"] | null;
    freshness?: Memory["freshness"] | null;
  } = {};
  if (typeof body.content === "string") changes.content = body.content;
  if (Array.isArray(body.tags)) {
    changes.tags = (body.tags as unknown[]).filter((t): t is string => typeof t === "string");
  }
  const metadata = parseWorkMemoryMetadataFromBody(body);
  if (!metadata.ok) {
    jsonResponse(res, 400, { error: metadata.message });
    return;
  }
  if (body.provenance !== undefined) {
    changes.provenance = metadata.metadata?.provenance ?? null;
  }
  if (body.freshness !== undefined) {
    changes.freshness = metadata.metadata?.freshness ?? null;
  }
  try {
    const provider = resolveMemoryRouteProvider(req, res, scopeStores);
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
  scopeStores?: MemoryScopeStores,
): void {
  try {
    const provider = resolveMemoryRouteProvider(req, res, scopeStores);
    if (!provider) return;
    const result = deleteMemory(provider, id);
    if (!result.ok) {
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
  scopeStores?: MemoryScopeStores,
): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const query = url.searchParams.get("q") ?? "";
  const tag = url.searchParams.get("tag") ?? undefined;
  const since = url.searchParams.get("since") ?? undefined;
  const semantic = url.searchParams.get("semantic") === "true";
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10) || 0) : 20;
  try {
    const provider = resolveMemoryRouteProvider(req, res, scopeStores);
    if (!provider) return;
    jsonResponse(res, 200, await searchMemory(provider, query, {
      tag,
      since,
      semantic,
      limit,
    }));
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleReindexMemory(
  req: IncomingMessage,
  res: ServerResponse,
  scopeStores?: MemoryScopeStores,
): Promise<void> {
  try {
    const provider = resolveMemoryRouteProvider(req, res, scopeStores);
    if (!provider) return;
    jsonResponse(res, 200, await reindexMemory(provider));
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}


export function memoryRoutes(scopeStores: MemoryScopeStores): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/memory",
      handler: (req, res) => handleListMemory(req, res, scopeStores),
    },
    {
      method: "GET",
      path: "/api/memory/search",
      handler: (req, res) => handleSearchMemory(req, res, scopeStores),
    },
    {
      method: "POST",
      path: "/api/memory",
      handler: (req, res) => handleAddMemory(req, res, scopeStores),
    },
    {
      method: "POST",
      path: "/api/memory/reindex",
      handler: (req, res) => handleReindexMemory(req, res, scopeStores),
    },
    {
      method: "GET",
      path: "/api/memory/:id",
      handler: (req, res, params) =>
        handleGetMemory(req, res, params.id, scopeStores),
    },
    {
      method: "DELETE",
      path: "/api/memory/:id",
      handler: (req, res, params) =>
        handleDeleteMemory(req, res, params.id, scopeStores),
    },
    {
      method: "PATCH",
      path: "/api/memory/:id",
      handler: (req, res, params) =>
        handleUpdateMemory(req, res, params.id, scopeStores),
    },
  ];
}
