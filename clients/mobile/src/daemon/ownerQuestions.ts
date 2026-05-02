// Owner-question entries surfaced by the daemon's `/owner-questions`
// routes.

import { daemonRequest, type DaemonHttp } from './http';

export type OwnerQuestionStatus = 'pending' | 'answered' | 'dismissed' | 'expired';

export interface OwnerQuestion {
  id: string;
  context: string;
  question: string;
  reason: string;
  source: string;
  createdAt: string;
  status: OwnerQuestionStatus;
  proposedAnswers?: string[];
  answer?: string;
  answeredAt?: string;
}

export function getOwnerQuestions(
  http: DaemonHttp,
): Promise<{ questions: OwnerQuestion[] }> {
  return daemonRequest<{ questions: OwnerQuestion[] }>(
    http,
    '/owner-questions',
  );
}

export function answerOwnerQuestion(
  http: DaemonHttp,
  id: string,
  answer: string,
): Promise<{ question: OwnerQuestion }> {
  return daemonRequest<{ question: OwnerQuestion }>(
    http,
    `/owner-questions/${encodeURIComponent(id)}/answer`,
    {
      method: 'POST',
      body: JSON.stringify({ answer }),
    },
  );
}

export function dismissOwnerQuestion(
  http: DaemonHttp,
  id: string,
  reason?: string,
): Promise<{ question: OwnerQuestion }> {
  return daemonRequest<{ question: OwnerQuestion }>(
    http,
    `/owner-questions/${encodeURIComponent(id)}/dismiss`,
    {
      method: 'POST',
      body: reason !== undefined ? JSON.stringify({ reason }) : undefined,
    },
  );
}
