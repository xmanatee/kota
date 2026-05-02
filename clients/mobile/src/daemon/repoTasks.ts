import { daemonRequest, type DaemonHttp } from './http';

// Mirror of a single search hit returned by the daemon's
// `GET /tasks/search` route. Decoding is restricted to the eight fields
// the shared `renderRepoTaskSearchPlain` helper consumes
// (`src/modules/repo-tasks/render.ts` and the `RepoTaskSearchHit` shape
// in `src/core/modules/provider-types.ts`) so the mobile surface speaks
// the same line shape as Telegram, the CLI, the daemon HTTP route, and
// the macOS menu bar.
export interface RepoTaskSearchHit {
  id: string;
  title: string;
  state: string;
  priority: string;
  area: string;
  summary: string;
  updatedAt: string;
  score: number;
}

// Discriminated mirror of the daemon's `GET /tasks/search` response:
// `{ ok: true, tasks }` on success and
// `{ ok: false, reason: "semantic_unavailable" }` when the configured
// `repo-tasks` provider does not support semantic search. Strict so
// payload drift fails loudly instead of silently degrading the rendered
// surface.
export type TasksSearchResponse =
  | { ok: true; tasks: RepoTaskSearchHit[] }
  | { ok: false; reason: 'semantic_unavailable' };

// Targets the daemon's `GET /tasks/search?q=&semantic=true&limit=`
// control route and decodes the discriminated success /
// `semantic_unavailable` envelope. Note the route lives at
// `/tasks/search` (not under `/api/`), matching the daemon control
// registration. Mirrors the macOS `DaemonClient.searchTasks` decode
// discipline.
export async function searchTasks(
  http: DaemonHttp,
  query: string,
  limit = 10,
): Promise<TasksSearchResponse> {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('semantic', 'true');
  params.set('limit', String(limit));
  const parsed = await daemonRequest<unknown>(
    http,
    `/tasks/search?${params.toString()}`,
  );
  return parseTasksSearchResponse(parsed);
}

export function parseTasksSearchResponse(value: unknown): TasksSearchResponse {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid tasks search response: not an object');
  }
  const obj = value as Record<string, unknown>;
  if (obj.ok === true) {
    if (!Array.isArray(obj.tasks)) {
      throw new Error('Invalid tasks search response: tasks missing');
    }
    const tasks = obj.tasks.map(parseRepoTaskSearchHit);
    return { ok: true, tasks };
  }
  if (obj.ok === false) {
    if (obj.reason !== 'semantic_unavailable') {
      throw new Error(
        `Invalid tasks search response: unknown reason ${String(obj.reason)}`,
      );
    }
    return { ok: false, reason: 'semantic_unavailable' };
  }
  throw new Error('Invalid tasks search response: missing ok flag');
}

function parseRepoTaskSearchHit(value: unknown): RepoTaskSearchHit {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid repo task hit');
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.id !== 'string' ||
    typeof obj.title !== 'string' ||
    typeof obj.state !== 'string' ||
    typeof obj.priority !== 'string' ||
    typeof obj.area !== 'string' ||
    typeof obj.summary !== 'string' ||
    typeof obj.updatedAt !== 'string' ||
    typeof obj.score !== 'number'
  ) {
    throw new Error('Invalid repo task hit: missing required fields');
  }
  return {
    id: obj.id,
    title: obj.title,
    state: obj.state,
    priority: obj.priority,
    area: obj.area,
    summary: obj.summary,
    updatedAt: obj.updatedAt,
    score: obj.score,
  };
}
