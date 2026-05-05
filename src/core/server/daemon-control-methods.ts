/**
 * Non-namespace daemon-side transport functions.
 *
 * `DaemonControlClient` exposes these as instance methods by thin
 * delegation, mirroring how it already delegates namespace fields to the
 * assembled `DaemonClientHandlers` map. Keeping the wire calls here lets
 * `daemon-client.ts` focus on assembling and validating namespace
 * handlers and exposing the non-namespace transport surface as a façade.
 *
 * Each function takes the typed `DaemonTransport` as its first argument
 * and matches the daemon HTTP wire shape exactly. Callers that only need
 * one of these functions in isolation (e.g. integration tests of a
 * specific daemon route) can import it directly; production CLI code
 * still goes through `DaemonControlClient`.
 */
import type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
import type { CapabilityReadinessResponse } from "#core/daemon/capability-readiness.js";
import type { ClientIdentity } from "#core/daemon/client-identity.js";
import type {
  DaemonLiveStatus,
  DaemonSseEvent,
  HealthStatus,
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "#core/daemon/daemon-control.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { DaemonTransport } from "./daemon-transport.js";

/**
 * Fetch through the typed link, swallowing transport errors and returning
 * null on network failure. Used by methods that distinguish between several
 * HTTP status codes (e.g. 404 vs 409) where the link's `request<T>` shape
 * (which only returns `T | null`) is too narrow.
 */
async function safeFetchRaw(
  link: DaemonTransport,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response | null> {
  try {
    return await link.fetchRaw(path, {
      method,
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
  } catch {
    return null;
  }
}

export function getHealth(
  transport: DaemonTransport,
): Promise<{ status: string; components: HealthStatus } | null> {
  return transport.request("GET", "/health");
}

export function getDaemonStatus(
  transport: DaemonTransport,
): Promise<DaemonLiveStatus | null> {
  return transport.request("GET", "/status");
}

export function getCapabilities(
  transport: DaemonTransport,
): Promise<CapabilityReadinessResponse | null> {
  return transport.request("GET", "/capabilities");
}

export function getIdentity(
  transport: DaemonTransport,
): Promise<ClientIdentity | null> {
  return transport.request("GET", "/identity");
}

export function getWorkflowStatus(
  transport: DaemonTransport,
): Promise<WorkflowLiveStatus | null> {
  return transport.request("GET", "/workflow/status");
}

export function getWorkflowDefinitions(
  transport: DaemonTransport,
): Promise<{ definitions: WorkflowDefinitionSummary[] } | null> {
  return transport.request("GET", "/workflow/definitions");
}

export function pause(
  transport: DaemonTransport,
): Promise<{ ok: boolean; paused: boolean; already?: boolean } | null> {
  return transport.request("POST", "/workflow/pause");
}

export function resume(
  transport: DaemonTransport,
): Promise<{ ok: boolean; paused: boolean; already?: boolean } | null> {
  return transport.request("POST", "/workflow/resume");
}

export function abort(
  transport: DaemonTransport,
): Promise<{ ok: boolean; aborted: number } | null> {
  return transport.request("POST", "/workflow/abort");
}

export function reload(
  transport: DaemonTransport,
): Promise<{ ok: boolean; count: number } | null> {
  return transport.request("POST", "/workflow/reload");
}

export function reloadConfig(
  transport: DaemonTransport,
): Promise<{ ok: boolean; workflows: number; changedModules: string[] } | null> {
  return transport.request("POST", "/reload");
}

export async function enableWorkflow(
  transport: DaemonTransport,
  name: string,
): Promise<{ ok: boolean; notFound?: boolean } | null> {
  const resp = await safeFetchRaw(transport, "POST", `/workflow/definitions/${encodeURIComponent(name)}/enable`);
  if (!resp) return null;
  if (resp.status === 404) return { ok: false, notFound: true };
  if (!resp.ok) return null;
  return (await resp.json()) as { ok: boolean };
}

export async function disableWorkflow(
  transport: DaemonTransport,
  name: string,
): Promise<{ ok: boolean; notFound?: boolean } | null> {
  const resp = await safeFetchRaw(transport, "POST", `/workflow/definitions/${encodeURIComponent(name)}/disable`);
  if (!resp) return null;
  if (resp.status === 404) return { ok: false, notFound: true };
  if (!resp.ok) return null;
  return (await resp.json()) as { ok: boolean };
}

export async function trigger(
  transport: DaemonTransport,
  name: string,
  tags?: string[],
  payload?: Record<string, unknown>,
): Promise<{ ok: boolean; queued?: string; runId?: string; alreadyQueued?: boolean } | null> {
  const resp = await safeFetchRaw(transport, "POST", "/workflow/trigger", {
    name,
    ...(tags && tags.length > 0 && { tags }),
    ...(payload && { payload }),
  });
  if (!resp) return null;
  if (resp.status === 409) return { ok: false, alreadyQueued: true };
  if (!resp.ok) return null;
  return (await resp.json()) as { ok: boolean; queued?: string; runId?: string };
}

export async function dryRun(
  transport: DaemonTransport,
  name: string,
  payload?: Record<string, unknown>,
): Promise<{ pass: boolean; notFound?: boolean; [key: string]: unknown } | null> {
  const resp = await safeFetchRaw(transport, "POST", "/api/workflow/dry-run", {
    name,
    ...(payload && { payload }),
  });
  if (!resp) return null;
  if (resp.status === 404) return { pass: false, notFound: true };
  if (!resp.ok && resp.status !== 422) return null;
  return (await resp.json()) as { pass: boolean; [key: string]: unknown };
}

export async function abortRun(
  transport: DaemonTransport,
  runId: string,
): Promise<{ ok: boolean; notFound?: boolean; queued?: boolean } | null> {
  const resp = await safeFetchRaw(transport, "POST", `/workflow/runs/${encodeURIComponent(runId)}/abort`);
  if (!resp) return null;
  if (resp.status === 404) return { ok: false, notFound: true };
  if (resp.status === 409) return { ok: false, queued: true };
  if (!resp.ok) return null;
  return (await resp.json()) as { ok: boolean };
}

export async function cancelRun(
  transport: DaemonTransport,
  runId: string,
): Promise<{ ok: boolean; notFound?: boolean; active?: boolean } | null> {
  const resp = await safeFetchRaw(transport, "DELETE", `/workflow/runs/${encodeURIComponent(runId)}`);
  if (!resp) return null;
  if (resp.status === 404) return { ok: false, notFound: true };
  if (resp.status === 409) return { ok: false, active: true };
  if (!resp.ok) return null;
  return (await resp.json()) as { ok: boolean };
}

export function listApprovals(
  transport: DaemonTransport,
  status?: ApprovalStatus | "all",
): Promise<{ approvals: PendingApproval[] } | null> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return transport.request("GET", `/approvals${query}`);
}

export function approveApproval(
  transport: DaemonTransport,
  id: string,
  note?: string,
): Promise<{ approval: PendingApproval } | null> {
  return transport.request("POST", `/approvals/${encodeURIComponent(id)}/approve`, { note });
}

export function rejectApproval(
  transport: DaemonTransport,
  id: string,
  reason?: string,
): Promise<{ approval: PendingApproval } | null> {
  return transport.request("POST", `/approvals/${encodeURIComponent(id)}/reject`, { reason });
}

export function approveAllApprovals(
  transport: DaemonTransport,
  note?: string,
): Promise<{ approvals: PendingApproval[]; count: number } | null> {
  return transport.request("POST", "/approvals/approve-all", { note });
}

export function rejectAllApprovals(
  transport: DaemonTransport,
  reason?: string,
): Promise<{ approvals: PendingApproval[]; count: number } | null> {
  return transport.request("POST", "/approvals/reject-all", { reason });
}

export function listWorkflowRuns(
  transport: DaemonTransport,
  workflow?: string,
  limit?: number,
  tag?: string,
  causedByRunId?: string,
): Promise<{ runs: WorkflowRunSummary[] } | null> {
  const params = new URLSearchParams();
  if (workflow) params.set("workflow", workflow);
  if (limit !== undefined) params.set("limit", String(limit));
  if (tag) params.set("tag", tag);
  if (causedByRunId) params.set("causedByRunId", causedByRunId);
  const query = params.toString() ? `?${params.toString()}` : "";
  return transport.request("GET", `/workflow/runs${query}`);
}

export function getWorkflowRun(
  transport: DaemonTransport,
  id: string,
): Promise<WorkflowRunDetail | null> {
  return transport.request("GET", `/workflow/runs/${encodeURIComponent(id)}`);
}

export async function registerSession(
  transport: DaemonTransport,
  id: string,
  createdAt: string,
  autonomyMode: AutonomyMode,
): Promise<boolean> {
  const resp = await safeFetchRaw(transport, "POST", "/sessions/register", { id, createdAt, autonomyMode });
  return resp?.ok ?? false;
}

export async function unregisterSession(
  transport: DaemonTransport,
  id: string,
): Promise<boolean> {
  const resp = await safeFetchRaw(transport, "DELETE", `/sessions/${encodeURIComponent(id)}`);
  return (resp?.ok ?? false) || resp?.status === 204;
}

export function queryEvents(
  transport: DaemonTransport,
  opts?: { type?: string; since?: string; limit?: number },
): Promise<{ events: Array<{ type: string; payload: Record<string, unknown>; timestamp: string }> } | null> {
  const params = new URLSearchParams();
  if (opts?.type) params.set("type", opts.type);
  if (opts?.since) params.set("since", opts.since);
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return transport.request("GET", `/api/events${qs ? `?${qs}` : ""}`);
}

export function events(transport: DaemonTransport): AsyncGenerator<DaemonSseEvent> {
  return transport.events();
}
