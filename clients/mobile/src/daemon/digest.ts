// Mirror of the daemon's `DailyDigestData` shape exported from
// `src/modules/autonomy/workflows/daily-digest/aggregate.ts`. Mobile
// decodes `GET /api/digest` through these typed structures so the rendered
// body stays identical to the Telegram, CLI, daemon HTTP, web, and macOS
// surfaces.

import { daemonRequest, type DaemonHttp } from './http';

export interface DigestBuilderCommitItem {
  runId: string;
  taskId: string | null;
  taskTitle: string | null;
  commitSubject: string;
  durationMs: number | null;
}

export interface DigestExplorerAdditionItem {
  runId: string;
  taskCount: number;
  watchlistAdds: number;
}

export interface DigestDecomposerSplitItem {
  runId: string;
  parentTaskId: string | null;
  childTaskCount: number;
}

export interface DigestBlockedPromoterMoveItem {
  runId: string;
  promotedTaskIds: string[];
  toReady: string[];
  toBacklog: string[];
}

export interface DigestFailedRunItem {
  runId: string;
  workflow: string;
  status: 'failed' | 'interrupted';
  startedAt: string;
}

export interface DigestPendingOwnerQuestionItem {
  id: string;
  question: string;
  source: string;
  ageDays: number;
}

export interface DigestAgingOperatorCaptureItem {
  taskId: string;
  ageDays: number;
  path: string;
}

export interface DigestQueueCounts {
  backlog: number;
  ready: number;
  doing: number;
  blocked: number;
}

export interface DigestQueueDelta {
  current: DigestQueueCounts;
  previous: DigestQueueCounts | null;
  delta: { [K in keyof DigestQueueCounts]: number | null };
}

export interface DailyDigestData {
  windowStartedAt: string;
  windowEndedAt: string;
  builderCommits: DigestBuilderCommitItem[];
  explorerAdditions: DigestExplorerAdditionItem[];
  decomposerSplits: DigestDecomposerSplitItem[];
  blockedPromoterMoves: DigestBlockedPromoterMoveItem[];
  failedMonitoredRuns: DigestFailedRunItem[];
  pendingOwnerQuestions: DigestPendingOwnerQuestionItem[];
  agingOperatorCaptures: DigestAgingOperatorCaptureItem[];
  queueDelta: DigestQueueDelta;
  quiet: boolean;
}

export interface DigestResponse {
  data: DailyDigestData;
  text: string;
}

export function getDigest(http: DaemonHttp): Promise<DigestResponse> {
  return daemonRequest<DigestResponse>(http, '/api/digest');
}
