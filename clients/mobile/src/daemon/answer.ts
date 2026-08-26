import {
  parseAnswerHistoryListResult,
  parseAnswerHistoryShowResult,
  parseAnswerResult,
  type AnswerFilter,
  type AnswerHistoryListResult,
  type AnswerHistoryShowResult,
  type AnswerResult,
} from './daemon-contract.generated';
import { daemonRequest, type DaemonHttp } from './http';

export type {
  AnswerCitation,
  AnswerFilter,
  AnswerHistoryEntry,
  AnswerHistoryListResult,
  AnswerHistoryRecord,
  AnswerHistoryShowResult,
  AnswerResult,
} from './daemon-contract.generated';
export {
  parseAnswerHistoryListResult,
  parseAnswerHistoryShowResult,
  parseAnswerResult,
} from './daemon-contract.generated';

export type AnswerHistoryListFilter = { limit?: number; beforeId?: string };

export async function answer(
  http: DaemonHttp,
  query: string,
  options: AnswerFilter = {},
): Promise<AnswerResult> {
  const filter = { ...options };
  const body: Record<string, unknown> = { query };
  if (Object.keys(filter).length > 0) body.filter = filter;
  return parseAnswerResult(await daemonRequest<unknown>(http, '/api/answer', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
}

export async function answerLog(
  http: DaemonHttp,
  filter: AnswerHistoryListFilter = {},
): Promise<AnswerHistoryListResult> {
  const params = new URLSearchParams();
  if (filter.limit !== undefined) params.set('limit', String(filter.limit));
  if (filter.beforeId !== undefined) params.set('beforeId', filter.beforeId);
  const query = params.toString();
  return parseAnswerHistoryListResult(
    await daemonRequest<unknown>(http, `/api/answers${query ? `?${query}` : ''}`),
  );
}

export async function answerShow(
  http: DaemonHttp,
  id: string,
): Promise<AnswerHistoryShowResult> {
  return parseAnswerHistoryShowResult(
    await daemonRequest<unknown>(http, `/api/answers/${encodeURIComponent(id)}`),
  );
}
