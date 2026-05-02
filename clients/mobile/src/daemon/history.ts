import { daemonRequest, type DaemonHttp } from './http';

// Mirror of a single conversation summary returned by the daemon's
// `GET /api/history/search` route. Decoding is restricted to the eight
// fields the shared `renderHistorySearchPlain` helper consumes
// (`src/modules/history/render.ts` and the `ConversationRecord` shape
// in `src/core/modules/provider-types.ts`) so the mobile surface speaks
// the same line shape as Telegram, the CLI, the daemon HTTP route, and
// the macOS menu bar. `source` is the only optional field, matching
// the upstream type one-to-one.
export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
  cwd: string;
  source?: 'user' | 'action';
}

// Discriminated mirror of the daemon's `GET /api/history/search`
// response: `{ ok: true, conversations }` on success and
// `{ ok: false, reason: "semantic_unavailable" }` when the configured
// history provider does not support semantic search. Strict so payload
// drift fails loudly instead of silently degrading the rendered surface.
export type HistorySearchResponse =
  | { ok: true; conversations: ConversationRecord[] }
  | { ok: false; reason: 'semantic_unavailable' };

// Targets the daemon's `GET /api/history/search?q=&semantic=true&limit=`
// route and decodes the discriminated success / `semantic_unavailable`
// envelope. Mirrors the macOS `DaemonClient.searchHistory` decode
// discipline: payload drift throws instead of silently degrading.
export async function searchHistory(
  http: DaemonHttp,
  query: string,
  limit = 10,
): Promise<HistorySearchResponse> {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('semantic', 'true');
  params.set('limit', String(limit));
  const parsed = await daemonRequest<unknown>(
    http,
    `/api/history/search?${params.toString()}`,
  );
  return parseHistorySearchResponse(parsed);
}

export function parseHistorySearchResponse(
  value: unknown,
): HistorySearchResponse {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid history search response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    if (!Array.isArray(obj.conversations)) {
      throw new Error(
        'Invalid history search response: conversations missing',
      );
    }
    const conversations = obj.conversations.map(parseConversationRecord);
    return { ok: true, conversations };
  }
  if (obj.ok === false) {
    if (obj.reason !== 'semantic_unavailable') {
      throw new Error(
        `Invalid history search response: unknown reason ${String(obj.reason)}`,
      );
    }
    return { ok: false, reason: 'semantic_unavailable' };
  }
  throw new Error('Invalid history search response: missing ok flag');
}

export function parseConversationRecord(value: unknown): ConversationRecord {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid conversation record');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.title !== 'string' ||
    typeof obj.createdAt !== 'string' ||
    typeof obj.updatedAt !== 'string' ||
    typeof obj.model !== 'string' ||
    typeof obj.messageCount !== 'number' ||
    typeof obj.cwd !== 'string'
  ) {
    throw new Error('Invalid conversation record: missing required fields');
  }
  const record: ConversationRecord = {
    id: obj.id,
    title: obj.title,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    model: obj.model,
    messageCount: obj.messageCount,
    cwd: obj.cwd,
  };
  if (obj.source === 'user' || obj.source === 'action') {
    record.source = obj.source;
  } else if (obj.source !== undefined) {
    throw new Error(
      `Invalid conversation record: unknown source ${String(obj.source)}`,
    );
  }
  return record;
}
