import { daemonRequest, type DaemonHttp } from './http';

// Mirror of a single entry returned by the daemon's
// `GET /api/knowledge/search` route. Decoding is restricted to the four
// fields the shared `renderKnowledgeSearchPlain` helper consumes
// (`src/modules/knowledge/render.ts`) so the mobile surface speaks the
// same line shape as Telegram, the CLI, the embedded web panel, and the
// macOS menu bar.
export interface KnowledgeEntry {
  id: string;
  type: string;
  status: string;
  title: string;
}

// Discriminated mirror of the daemon's `GET /api/knowledge/search`
// response: `{ ok: true, entries }` on success and
// `{ ok: false, reason: "semantic_unavailable" }` when no
// embedding-backed knowledge provider is configured. Strict so payload
// drift fails loudly instead of silently degrading the rendered surface.
export type KnowledgeSearchResponse =
  | { ok: true; entries: KnowledgeEntry[] }
  | { ok: false; reason: 'semantic_unavailable' };

// Targets the daemon's `GET /api/knowledge/search?q=&semantic=true&limit=`
// route and decodes the discriminated success / `semantic_unavailable`
// envelope. Mirrors the macOS `DaemonClient.searchKnowledge` decode
// discipline: the response shape is validated explicitly so payload
// drift throws instead of silently degrading to keyword search behind
// the operator's back.
export async function searchKnowledge(
  http: DaemonHttp,
  query: string,
  limit = 10,
): Promise<KnowledgeSearchResponse> {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('semantic', 'true');
  params.set('limit', String(limit));
  const parsed = await daemonRequest<unknown>(
    http,
    `/api/knowledge/search?${params.toString()}`,
  );
  return parseKnowledgeSearchResponse(parsed);
}

export function parseKnowledgeSearchResponse(
  value: unknown,
): KnowledgeSearchResponse {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid knowledge search response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    if (!Array.isArray(obj.entries)) {
      throw new Error('Invalid knowledge search response: entries missing');
    }
    const entries = obj.entries.map(parseKnowledgeEntry);
    return { ok: true, entries };
  }
  if (obj.ok === false) {
    if (obj.reason !== 'semantic_unavailable') {
      throw new Error(
        `Invalid knowledge search response: unknown reason ${String(obj.reason)}`,
      );
    }
    return { ok: false, reason: 'semantic_unavailable' };
  }
  throw new Error('Invalid knowledge search response: missing ok flag');
}

function parseKnowledgeEntry(value: unknown): KnowledgeEntry {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid knowledge entry');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.type !== 'string' ||
    typeof obj.status !== 'string' ||
    typeof obj.title !== 'string'
  ) {
    throw new Error('Invalid knowledge entry: missing required fields');
  }
  return { id: obj.id, type: obj.type, status: obj.status, title: obj.title };
}
