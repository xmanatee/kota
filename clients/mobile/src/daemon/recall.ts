import {
  parseRecallResult,
  type RecallFilter,
  type RecallResult,
} from './daemon-contract.generated';
import { daemonRequest, type DaemonHttp } from './http';

export type {
  RecallAnswerHit,
  RecallAnswerHitResult,
  RecallFilter,
  RecallHistoryHit,
  RecallHit,
  RecallKnowledgeHit,
  RecallMemoryHit,
  RecallResult,
  RecallSource,
  RecallTasksHit,
  WorkMemoryFreshness,
  WorkMemoryFreshnessState,
  WorkMemoryProvenance,
  WorkMemorySourceKind,
} from './daemon-contract.generated';
export { parseRecallResult as parseRecallSearchResponse } from './daemon-contract.generated';

export type RecallSearchResponse = RecallResult;

export async function recall(
  http: DaemonHttp,
  query: string,
  options: RecallFilter = {},
): Promise<RecallResult> {
  const filter = { ...options };
  const body: Record<string, unknown> = { query };
  if (Object.keys(filter).length > 0) body.filter = filter;
  return parseRecallResult(await daemonRequest<unknown>(http, '/api/recall', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
}
