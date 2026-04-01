import type { IncomingMessage, ServerResponse } from "node:http";
import type { KnowledgeEntry } from "../memory/knowledge-store-helpers.js";
import { getKnowledgeProvider } from "../providers.js";
import { jsonResponse, readBody } from "./session-pool.js";

type KnowledgeListItem = {
  id: string;
  title: string;
  type: string;
  tags: string[];
  status: string;
  excerpt: string;
};

type KnowledgeListResponse = {
  entries: KnowledgeListItem[];
};

function toListItem(entry: KnowledgeEntry): KnowledgeListItem {
  return {
    id: entry.id,
    title: entry.title,
    type: entry.type,
    tags: entry.tags,
    status: entry.status,
    excerpt: entry.content.slice(0, 200).replace(/\s+/g, " ").trim(),
  };
}

export function handleListKnowledge(
  res: ServerResponse,
  cwd = process.cwd(),
): void {
  try {
    const provider = getKnowledgeProvider(cwd);
    const all = provider.list({ scope: "all" });
    jsonResponse(res, 200, { entries: all.map(toListItem) } satisfies KnowledgeListResponse);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function handleGetKnowledge(
  res: ServerResponse,
  id: string,
  cwd = process.cwd(),
): void {
  try {
    const provider = getKnowledgeProvider(cwd);
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
  cwd = process.cwd(),
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
  const tags = Array.isArray(body.tags) ? (body.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
  try {
    const provider = getKnowledgeProvider(cwd);
    const id = provider.create({ title, content, type, tags, status });
    jsonResponse(res, 201, { id });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function handleDeleteKnowledge(
  res: ServerResponse,
  id: string,
  cwd = process.cwd(),
): void {
  try {
    const provider = getKnowledgeProvider(cwd);
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
