import {
  parseTasksSearchResponse,
  type TasksSearchResponse,
} from './daemon-contract.generated';
import { daemonRequest, type DaemonHttp } from './http';

export type { RepoTaskSearchHit, TasksSearchResponse } from './daemon-contract.generated';
export { parseTasksSearchResponse } from './daemon-contract.generated';

export async function searchTasks(
  http: DaemonHttp,
  query: string,
  limit = 10,
): Promise<TasksSearchResponse> {
  const params = new URLSearchParams({ q: query, semantic: 'true', limit: String(limit) });
  return parseTasksSearchResponse(
    await daemonRequest<unknown>(http, `/tasks/search?${params}`),
  );
}
