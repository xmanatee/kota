import {
  parseHistorySearchResponse,
  type HistorySearchResponse,
} from './daemon-contract.generated';
import { daemonRequest, type DaemonHttp } from './http';

export type { ConversationRecord, HistorySearchResponse } from './daemon-contract.generated';
export { parseHistorySearchResponse } from './daemon-contract.generated';

export async function searchHistory(
  http: DaemonHttp,
  query: string,
  limit = 10,
): Promise<HistorySearchResponse> {
  const params = new URLSearchParams({ q: query, semantic: 'true', limit: String(limit) });
  return parseHistorySearchResponse(
    await daemonRequest<unknown>(http, `/api/history/search?${params}`),
  );
}
