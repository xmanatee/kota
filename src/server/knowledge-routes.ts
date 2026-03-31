import type { ServerResponse } from "node:http";
import type { KnowledgeEntry } from "../memory/knowledge-store-helpers.js";
import { getKnowledgeProvider } from "../providers.js";
import { jsonResponse } from "./session-pool.js";

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
