import { daemonRequest, type DaemonHttp } from './http';

// Mirror of a single entry returned by the daemon's
// `GET /api/memory/search` route. Decoding is restricted to the three
// fields the shared `renderMemorySearchPlain` helper consumes
// (`src/modules/memory/render.ts`) so the mobile surface speaks the
// same line shape as Telegram, the CLI, the daemon HTTP route, and the
// macOS menu bar.
export interface MemoryEntry {
  id: string;
  created: string;
  content: string;
}

// Discriminated mirror of the daemon's `GET /api/memory/search`
// response: `{ ok: true, entries }` on success and
// `{ ok: false, reason: "semantic_unavailable" }` when no
// embedding-backed memory provider is configured. Strict so payload
// drift fails loudly instead of silently degrading the rendered surface.
export type MemorySearchResponse =
  | { ok: true; entries: MemoryEntry[] }
  | { ok: false; reason: 'semantic_unavailable' };

// Targets the daemon's `GET /api/memory/search?q=&semantic=true&limit=`
// route and decodes the discriminated success / `semantic_unavailable`
// envelope. Mirrors the macOS `DaemonClient.searchMemory` decode
// discipline: payload drift throws instead of silently degrading to
// keyword search behind the operator's back.
export async function searchMemory(
  http: DaemonHttp,
  query: string,
  limit = 10,
): Promise<MemorySearchResponse> {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('semantic', 'true');
  params.set('limit', String(limit));
  const parsed = await daemonRequest<unknown>(
    http,
    `/api/memory/search?${params.toString()}`,
  );
  return parseMemorySearchResponse(parsed);
}

export function parseMemorySearchResponse(
  value: unknown,
): MemorySearchResponse {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid memory search response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    if (!Array.isArray(obj.entries)) {
      throw new Error('Invalid memory search response: entries missing');
    }
    const entries = obj.entries.map(parseMemoryEntry);
    return { ok: true, entries };
  }
  if (obj.ok === false) {
    if (obj.reason !== 'semantic_unavailable') {
      throw new Error(
        `Invalid memory search response: unknown reason ${String(obj.reason)}`,
      );
    }
    return { ok: false, reason: 'semantic_unavailable' };
  }
  throw new Error('Invalid memory search response: missing ok flag');
}

function parseMemoryEntry(value: unknown): MemoryEntry {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid memory entry');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.created !== 'string' ||
    typeof obj.content !== 'string'
  ) {
    throw new Error('Invalid memory entry: missing required fields');
  }
  return { id: obj.id, created: obj.created, content: obj.content };
}
