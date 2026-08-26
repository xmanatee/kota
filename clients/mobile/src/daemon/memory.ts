import {
  parseMemorySearchResponse,
  type MemorySearchResponse,
} from './daemon-contract.generated';
import { daemonRequest, type DaemonHttp } from './http';

export type { MemoryListEntry as MemoryEntry, MemorySearchResponse } from './daemon-contract.generated';
export { parseMemorySearchResponse } from './daemon-contract.generated';

export async function searchMemory(
  http: DaemonHttp,
  query: string,
  limit = 10,
): Promise<MemorySearchResponse> {
  const params = new URLSearchParams({ q: query, semantic: 'true', limit: String(limit) });
  return parseMemorySearchResponse(
    await daemonRequest<unknown>(http, `/api/memory/search?${params}`),
  );
}
