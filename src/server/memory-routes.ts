import type { IncomingMessage, ServerResponse } from "node:http";
import { getMemoryProvider } from "../extensions/providers/index.js";
import type { Memory } from "../memory/store.js";
import { jsonResponse, readBody } from "./session-pool.js";

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

export function handleListMemory(res: ServerResponse): void {
  try {
    const provider = getMemoryProvider();
    const all = provider.list();
    jsonResponse(res, 200, { entries: all.map(toListItem) } satisfies MemoryListResponse);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function handleGetMemory(res: ServerResponse, id: string): void {
  try {
    const provider = getMemoryProvider();
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

export async function handleAddMemory(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    const provider = getMemoryProvider();
    const id = provider.save(content, tags);
    jsonResponse(res, 201, { id });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleUpdateMemory(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
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
    const provider = getMemoryProvider();
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

export function handleDeleteMemory(res: ServerResponse, id: string): void {
  try {
    const provider = getMemoryProvider();
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
