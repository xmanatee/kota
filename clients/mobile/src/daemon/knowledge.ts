import {
  parseKnowledgeSearchResponse,
  type KnowledgeSearchResponse,
} from './daemon-contract.generated';
import { daemonRequest, type DaemonHttp } from './http';

export type { KnowledgeEntry, KnowledgeSearchResponse } from './daemon-contract.generated';
export { parseKnowledgeSearchResponse } from './daemon-contract.generated';

export async function searchKnowledge(
  http: DaemonHttp,
  query: string,
  limit = 10,
): Promise<KnowledgeSearchResponse> {
  const params = new URLSearchParams({ q: query, semantic: 'true', limit: String(limit) });
  return parseKnowledgeSearchResponse(
    await daemonRequest<unknown>(http, `/api/knowledge/search?${params}`),
  );
}
