// Daemon health, status, and run-detail types. Mirrors the shapes the
// daemon control API exposes for general lifecycle (`/health`, `/status`,
// `/workflow/runs`, `/workflow/pause`, `/workflow/resume`).

import { daemonRequest, type DaemonHttp } from './http';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptimeMs: number;
  components: Record<string, string>;
}

export interface ActiveRun {
  runId: string;
  workflow: string;
  startedAt: string;
}

export interface WorkflowState {
  activeRuns: ActiveRun[];
  queueLength: number;
  completedRuns: number;
  paused: boolean;
  dispatchWindowBlocked?: boolean;
  dispatchWindowOpensAt?: string;
}

export interface DaemonStatus {
  running: boolean;
  pid: number;
  startedAt: string;
  completedRuns: number;
  lastCompletedWorkflow?: string;
  lastCompletedAt?: string;
  lastCompletedStatus?: string;
  workflow: WorkflowState;
}

export type RunStatus =
  | 'success'
  | 'failed'
  | 'interrupted'
  | 'completed-with-warnings';

export interface RunSummary {
  id: string;
  workflow: string;
  status: RunStatus;
  triggerEvent: string;
  startedAt: string;
  durationMs: number;
  totalCostUsd?: number;
  causedBy?: { runId: string; workflow: string };
  tags?: string[];
}

export interface ToolCall {
  tool: string;
  count: number;
  totalMs: number;
}

export interface RunStep {
  id: string;
  type: string;
  status: string;
  durationMs: number;
  costUsd?: number;
  toolCalls?: ToolCall[];
  reused?: boolean;
}

export interface RunDetail extends RunSummary {
  completedAt?: string;
  steps: RunStep[];
  workflowSteps?: Array<{ id: string; type: string; reason?: string }>;
  warnings?: Array<{ type: string; message: string }>;
}

// `/health` is intentionally public (no bearer token) — it's the daemon
// reachability probe.
export function getHealth(http: DaemonHttp): Promise<HealthResponse> {
  return fetch(`${http.baseUrl}/health`).then((r) => r.json());
}

export function getStatus(http: DaemonHttp): Promise<DaemonStatus> {
  return daemonRequest<DaemonStatus>(http, '/status');
}

export function getRuns(
  http: DaemonHttp,
  workflow?: string,
  limit = 20,
): Promise<{ runs: RunSummary[] }> {
  const params = new URLSearchParams();
  if (workflow) params.set('workflow', workflow);
  params.set('limit', String(limit));
  return daemonRequest<{ runs: RunSummary[] }>(
    http,
    `/workflow/runs?${params}`,
  );
}

export function getRunDetail(http: DaemonHttp, id: string): Promise<RunDetail> {
  return daemonRequest<RunDetail>(
    http,
    `/workflow/runs/${encodeURIComponent(id)}`,
  );
}

export function pauseDispatch(
  http: DaemonHttp,
): Promise<{ ok: boolean; paused: boolean }> {
  return daemonRequest(http, '/workflow/pause', { method: 'POST' });
}

export function resumeDispatch(
  http: DaemonHttp,
): Promise<{ ok: boolean; paused: boolean }> {
  return daemonRequest(http, '/workflow/resume', { method: 'POST' });
}
