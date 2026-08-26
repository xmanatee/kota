// Daemon health, status, and run-detail types. Mirrors the shapes the
// daemon control API exposes for general lifecycle (`/health`, `/status`,
// `/workflow/runs`, `/workflow/pause`, `/workflow/resume`).

import {
  parseClientIdentity,
  parseScopeRegistryProjection,
  parseScopePolicyRouteResponse,
  type ClientIdentity,
  type ScopeRegistryProjection,
  type ScopePolicyRouteResponse,
} from './daemon-contract.generated';
import {
  daemonRequest,
  daemonResponse,
  withScope,
  type DaemonHttp,
} from './http';

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

export type { ClientIdentity } from './daemon-contract.generated';

// `/health` is intentionally public (no bearer token) — it's the daemon
// reachability probe.
export function getHealth(http: DaemonHttp): Promise<HealthResponse> {
  return daemonResponse(http, '/health', {}, false).then((response) =>
    response.json() as Promise<HealthResponse>
  );
}

export async function getIdentity(http: DaemonHttp): Promise<ClientIdentity> {
  return parseClientIdentity(await daemonRequest<unknown>(http, '/identity'));
}

export async function getScopes(
  http: DaemonHttp,
): Promise<ScopeRegistryProjection> {
  const raw = await daemonRequest<unknown>(http, '/scopes');
  return parseScopeRegistryProjection(raw);
}

export async function getScopePolicy(
  http: DaemonHttp,
  scopeId: string,
): Promise<ScopePolicyRouteResponse> {
  const raw = await daemonRequest<unknown>(
    http,
    `/scopes/${encodeURIComponent(scopeId)}/policy`,
  );
  return parseScopePolicyRouteResponse(raw);
}

export function getStatus(
  http: DaemonHttp,
  scopeId?: string,
): Promise<DaemonStatus> {
  return daemonRequest<DaemonStatus>(http, withScope('/status', scopeId));
}

export function getRuns(
  http: DaemonHttp,
  workflow: string | undefined,
  limit: number,
  scopeId?: string,
): Promise<{ runs: RunSummary[] }> {
  const params = new URLSearchParams();
  if (workflow) params.set('workflow', workflow);
  params.set('limit', String(limit));
  return daemonRequest<{ runs: RunSummary[] }>(
    http,
    withScope(`/workflow/runs?${params}`, scopeId),
  );
}

export function getRunDetail(
  http: DaemonHttp,
  id: string,
  scopeId?: string,
): Promise<RunDetail> {
  return daemonRequest<RunDetail>(
    http,
    withScope(`/workflow/runs/${encodeURIComponent(id)}`, scopeId),
  );
}

export function pauseDispatch(
  http: DaemonHttp,
  scopeId?: string,
): Promise<{ ok: boolean; paused: boolean }> {
  return daemonRequest(http, withScope('/workflow/pause', scopeId), { method: 'POST' });
}

export function resumeDispatch(
  http: DaemonHttp,
  scopeId?: string,
): Promise<{ ok: boolean; paused: boolean }> {
  return daemonRequest(http, withScope('/workflow/resume', scopeId), { method: 'POST' });
}
