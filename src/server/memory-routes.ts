import type { ServerResponse } from "node:http";
import type { Memory } from "../memory/store.js";
import { getMemoryProvider } from "../providers.js";
import { jsonResponse } from "./session-pool.js";

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
