// Daemon health, status, and run-detail types. Mirrors the shapes the
// daemon control API exposes for general lifecycle (`/health`, `/status`,
// `/workflow/runs`, `/workflow/pause`, `/workflow/resume`).

import {
  parseProjectRegistryProjection,
  parseScopeRegistryProjection,
  parseScopePolicyRouteResponse,
  type ProjectRegistryProjection,
  type ScopeRegistryProjection,
  type ScopePolicyRouteResponse,
} from './conformance/decoders';
import { daemonRequest, withProject, type DaemonHttp } from './http';

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

/**
 * Permissive identity envelope used by the mobile client's project
 * selector. The strict cross-client conformance decoders (in
 * `./conformance/decoders.ts`) already validate the projects projection
 * field-by-field; we only re-parse `projects` here so the picker's
 * input is typed and rejects an empty / inconsistent registry the same
 * way the cross-client gate does.
 */
export interface ClientIdentity {
  projectName: string;
  projectDir: string;
  projects: ProjectRegistryProjection;
  daemonVersion: string;
  pid: number;
  startedAt: string;
}

// `/health` is intentionally public (no bearer token) — it's the daemon
// reachability probe.
export function getHealth(http: DaemonHttp): Promise<HealthResponse> {
  return fetch(`${http.baseUrl}/health`).then((r) => r.json());
}

export async function getIdentity(http: DaemonHttp): Promise<ClientIdentity> {
  const raw = await daemonRequest<Record<string, unknown>>(http, '/identity');
  const projects = parseProjectRegistryProjection(raw.projects);
  return {
    projectName: String(raw.projectName ?? ''),
    projectDir: String(raw.projectDir ?? ''),
    projects,
    daemonVersion: String(raw.daemonVersion ?? ''),
    pid: typeof raw.pid === 'number' ? raw.pid : 0,
    startedAt: String(raw.startedAt ?? ''),
  };
}

export async function getProjects(
  http: DaemonHttp,
): Promise<ProjectRegistryProjection> {
  const raw = await daemonRequest<unknown>(http, '/projects');
  return parseProjectRegistryProjection(raw);
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
  projectId?: string,
): Promise<DaemonStatus> {
  return daemonRequest<DaemonStatus>(http, withProject('/status', projectId));
}

export function getRuns(
  http: DaemonHttp,
  workflow: string | undefined,
  limit: number,
  projectId?: string,
): Promise<{ runs: RunSummary[] }> {
  const params = new URLSearchParams();
  if (workflow) params.set('workflow', workflow);
  params.set('limit', String(limit));
  return daemonRequest<{ runs: RunSummary[] }>(
    http,
    withProject(`/workflow/runs?${params}`, projectId),
  );
}

export function getRunDetail(
  http: DaemonHttp,
  id: string,
  projectId?: string,
): Promise<RunDetail> {
  return daemonRequest<RunDetail>(
    http,
    withProject(`/workflow/runs/${encodeURIComponent(id)}`, projectId),
  );
}

export function pauseDispatch(
  http: DaemonHttp,
  projectId?: string,
): Promise<{ ok: boolean; paused: boolean }> {
  return daemonRequest(http, withProject('/workflow/pause', projectId), { method: 'POST' });
}

export function resumeDispatch(
  http: DaemonHttp,
  projectId?: string,
): Promise<{ ok: boolean; paused: boolean }> {
  return daemonRequest(http, withProject('/workflow/resume', projectId), { method: 'POST' });
}
