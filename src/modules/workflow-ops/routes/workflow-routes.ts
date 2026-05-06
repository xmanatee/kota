import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkflowDefinitionSummary, WorkflowLiveStatus } from "#core/daemon/daemon-control.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import { formatRunId } from "#core/workflow/run-io.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowQueuedRun } from "#core/workflow/run-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { buildDryRunPlan, type DryRunResult } from "../execution/dry-run.js";

const EMPTY_WORKFLOW_STATUS: WorkflowLiveStatus = {
  activeRuns: [],
  pendingRuns: [],
  queueLength: 0,
  completedRuns: 0,
  workflows: {},
  paused: false,
  agentConcurrency: 1,
  codeConcurrency: 4,
};

export async function handleWorkflowStatus(
  res: ServerResponse,
  link: DaemonTransport | null = null,
): Promise<void> {
  if (!link) {
    jsonResponse(res, 200, EMPTY_WORKFLOW_STATUS);
    return;
  }
  const status = await link.request<WorkflowLiveStatus>("GET", "/workflow/status");
  jsonResponse(res, 200, status ?? EMPTY_WORKFLOW_STATUS);
}

export async function handleWorkflowDefinitions(
  res: ServerResponse,
  link: DaemonTransport | null = null,
): Promise<void> {
  if (!link) {
    jsonResponse(res, 200, { definitions: [] as WorkflowDefinitionSummary[] });
    return;
  }
  const result = await link.request<{ definitions: WorkflowDefinitionSummary[] }>(
    "GET",
    "/workflow/definitions",
  );
  jsonResponse(res, 200, result ?? { definitions: [] });
}

export async function handleWorkflowPause(
  res: ServerResponse,
  link: DaemonTransport | null = null,
): Promise<void> {
  if (!link) {
    jsonResponse(res, 503, { error: "Daemon not running" });
    return;
  }
  const result = await link.request<{ ok: boolean; paused: boolean; already?: boolean }>(
    "POST",
    "/workflow/pause",
  );
  if (!result) {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  jsonResponse(res, 200, result);
}

export async function handleWorkflowResume(
  res: ServerResponse,
  link: DaemonTransport | null = null,
): Promise<void> {
  if (!link) {
    jsonResponse(res, 503, { error: "Daemon not running" });
    return;
  }
  const result = await link.request<{ ok: boolean; paused: boolean; already?: boolean }>(
    "POST",
    "/workflow/resume",
  );
  if (!result) {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  jsonResponse(res, 200, result);
}

export async function handleWorkflowAbort(
  res: ServerResponse,
  link: DaemonTransport | null = null,
): Promise<void> {
  if (!link) {
    jsonResponse(res, 503, { error: "Daemon not running" });
    return;
  }
  const result = await link.request<{ ok: boolean; aborted: number }>(
    "POST",
    "/workflow/abort",
  );
  if (!result) {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  jsonResponse(res, 200, result);
}

export async function handleWorkflowRetry(
  req: IncomingMessage,
  res: ServerResponse,
  store = new WorkflowRunStore(),
  link: DaemonTransport | null = null,
): Promise<void> {
  if (!link) {
    jsonResponse(res, 503, { error: "Daemon not running" });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  const runId = body.runId as string | undefined;
  if (!runId || typeof runId !== "string" || !/^[a-zA-Z0-9._-]+$/.test(runId)) {
    jsonResponse(res, 400, { error: "runId must be a non-empty string" });
    return;
  }

  const run = store.getRun(runId);
  if (!run) {
    jsonResponse(res, 404, { error: `Run "${runId}" not found` });
    return;
  }

  if (run.status !== "failed" && run.status !== "interrupted") {
    jsonResponse(res, 409, { error: `Run "${runId}" cannot be retried (status: ${run.status})` });
    return;
  }

  const state = store.readState();
  const alreadyQueued = state.pendingRuns.some((r) => r.workflowName === run.workflow);
  if (alreadyQueued) {
    jsonResponse(res, 409, { error: `Workflow "${run.workflow}" is already queued` });
    return;
  }

  const now = Date.now();
  const trigger = { event: "retry", payload: { retryOf: runId, triggeredAt: new Date().toISOString() } };
  store.setPendingRuns([
    ...state.pendingRuns,
    { workflowName: run.workflow, trigger, enqueuedAtMs: now, notBeforeMs: now },
  ]);
  jsonResponse(res, 200, { ok: true, queued: run.workflow });
}

export async function handleWorkflowAbortRun(
  res: ServerResponse,
  runId: string,
  link: DaemonTransport | null = null,
): Promise<void> {
  if (!link) {
    jsonResponse(res, 503, { error: "Daemon not running" });
    return;
  }
  if (!runId || runId.includes("/") || runId.includes("..")) {
    jsonResponse(res, 400, { error: "Invalid run ID" });
    return;
  }
  let resp: Response;
  try {
    resp = await link.fetchRaw(`/workflow/runs/${encodeURIComponent(runId)}/abort`, {
      method: "POST",
    });
  } catch {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  if (resp.status === 404) {
    jsonResponse(res, 404, { error: `Run "${runId}" not found` });
    return;
  }
  if (resp.status === 409) {
    jsonResponse(res, 409, { error: `Run "${runId}" is queued, not active; use DELETE to cancel it` });
    return;
  }
  if (!resp.ok) {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  jsonResponse(res, 200, { ok: true });
}

export async function handleWorkflowCancel(
  res: ServerResponse,
  runId: string,
  link: DaemonTransport | null = null,
): Promise<void> {
  if (!link) {
    jsonResponse(res, 503, { error: "Daemon not running" });
    return;
  }
  if (!runId || runId.includes("/") || runId.includes("..")) {
    jsonResponse(res, 400, { error: "Invalid run ID" });
    return;
  }
  let resp: Response;
  try {
    resp = await link.fetchRaw(`/workflow/runs/${encodeURIComponent(runId)}`, {
      method: "DELETE",
    });
  } catch {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  if (resp.status === 404) {
    jsonResponse(res, 404, { error: `Run "${runId}" not found` });
    return;
  }
  if (resp.status === 409) {
    jsonResponse(res, 409, { error: `Run "${runId}" is already active and cannot be cancelled` });
    return;
  }
  if (!resp.ok) {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  jsonResponse(res, 200, { ok: true });
}

export async function handleWorkflowReplay(
  req: IncomingMessage,
  res: ServerResponse,
  store = new WorkflowRunStore(),
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  const runId = body.runId as string | undefined;
  if (!runId || typeof runId !== "string" || !/^[a-zA-Z0-9._-]+$/.test(runId)) {
    jsonResponse(res, 400, { error: "runId must be a non-empty string" });
    return;
  }

  const original = store.getRun(runId);
  if (!original) {
    jsonResponse(res, 404, { error: `Run "${runId}" not found` });
    return;
  }

  if (original.status === "running") {
    jsonResponse(res, 409, { error: `Run "${runId}" is still running. Cannot replay an active run.` });
    return;
  }

  const state = store.readState();
  const alreadyQueued = state.pendingRuns.some((r) => r.workflowName === original.workflow);
  if (alreadyQueued) {
    jsonResponse(res, 409, { error: `Workflow "${original.workflow}" is already queued` });
    return;
  }

  const originalPayload =
    typeof original.trigger?.payload === "object" && original.trigger.payload !== null
      ? (original.trigger.payload as Record<string, unknown>)
      : {};
  const { _runId: _discarded, ...cleanPayload } = originalPayload as Record<string, unknown> & { _runId?: unknown };

  const now = Date.now();
  const newRunId = formatRunId(original.workflow);
  const trigger = {
    event: "workflow.replay",
    payload: {
      ...cleanPayload,
      replayOf: runId,
      replayTriggeredAt: new Date().toISOString(),
      _runId: newRunId,
    },
  };
  const queued: WorkflowQueuedRun = {
    runId: newRunId,
    workflowName: original.workflow,
    trigger,
    enqueuedAtMs: now,
    notBeforeMs: now,
  };
  store.setPendingRuns([...state.pendingRuns, queued]);
  jsonResponse(res, 200, { ok: true, queued: original.workflow, runId: newRunId });
}

export async function handleWorkflowEnable(
  res: ServerResponse,
  name: string,
  link: DaemonTransport | null = null,
): Promise<void> {
  if (!link) {
    jsonResponse(res, 503, { error: "Daemon not running" });
    return;
  }
  let resp: Response;
  try {
    resp = await link.fetchRaw(`/workflow/definitions/${encodeURIComponent(name)}/enable`, {
      method: "POST",
    });
  } catch {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  if (resp.status === 404) {
    jsonResponse(res, 404, { error: `Workflow "${name}" not found` });
    return;
  }
  if (!resp.ok) {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  const body = (await resp.json()) as { ok: boolean };
  jsonResponse(res, 200, body);
}

export async function handleWorkflowDisable(
  res: ServerResponse,
  name: string,
  link: DaemonTransport | null = null,
): Promise<void> {
  if (!link) {
    jsonResponse(res, 503, { error: "Daemon not running" });
    return;
  }
  let resp: Response;
  try {
    resp = await link.fetchRaw(`/workflow/definitions/${encodeURIComponent(name)}/disable`, {
      method: "POST",
    });
  } catch {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  if (resp.status === 404) {
    jsonResponse(res, 404, { error: `Workflow "${name}" not found` });
    return;
  }
  if (!resp.ok) {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  const body = (await resp.json()) as { ok: boolean };
  jsonResponse(res, 200, body);
}

export async function handleWorkflowTrigger(
  req: IncomingMessage,
  res: ServerResponse,
  store = new WorkflowRunStore(),
  link: DaemonTransport | null = null,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  const name = body.name as string | undefined;
  if (!name || typeof name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    jsonResponse(res, 400, { error: "name must be a non-empty alphanumeric string" });
    return;
  }

  const tags =
    Array.isArray(body.tags) && (body.tags as unknown[]).every((t) => typeof t === "string")
      ? (body.tags as string[])
      : undefined;

  const extraPayload =
    body.payload !== undefined && body.payload !== null && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : undefined;

  if (link) {
    let resp: Response | null = null;
    try {
      resp = await link.fetchRaw("/workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          ...(tags && tags.length > 0 && { tags }),
          ...(extraPayload && { payload: extraPayload }),
        }),
      });
    } catch {
      // fall through to local enqueue
    }
    if (resp) {
      if (resp.status === 409) {
        jsonResponse(res, 409, { error: `Workflow "${name}" is already queued` });
        return;
      }
      if (resp.ok) {
        const body = (await resp.json()) as { queued?: string; runId?: string };
        jsonResponse(res, 200, { ok: true, queued: body.queued ?? name });
        return;
      }
    }
  }

  const state = store.readState();
  const alreadyQueued = state.pendingRuns.some((r) => r.workflowName === name);
  if (alreadyQueued) {
    jsonResponse(res, 409, { error: `Workflow "${name}" is already queued` });
    return;
  }

  const now = Date.now();
  const trigger = {
    event: "manual",
    payload: {
      ...(extraPayload ?? {}),
      triggeredAt: new Date().toISOString(),
      ...(tags && tags.length > 0 && { tags }),
    },
  };
  const queued: WorkflowQueuedRun = {
    workflowName: name,
    trigger,
    enqueuedAtMs: now,
    notBeforeMs: now,
  };
  store.setPendingRuns([...state.pendingRuns, queued]);
  jsonResponse(res, 200, { ok: true, queued: name });
}

export type DryRunDeps = {
  definitions: WorkflowDefinition[];
  availableToolNames: ReadonlySet<string>;
};

export async function handleWorkflowDryRun(
  req: IncomingMessage,
  res: ServerResponse,
  deps: DryRunDeps,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }

  const name = body.name as string | undefined;
  if (!name || typeof name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    jsonResponse(res, 400, { error: "name must be a non-empty alphanumeric string" });
    return;
  }

  const definition = deps.definitions.find((d) => d.name === name);
  if (!definition) {
    jsonResponse(res, 404, { error: `Workflow "${name}" not found` });
    return;
  }

  const payload =
    body.payload !== undefined && body.payload !== null && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : undefined;

  let result: DryRunResult;
  try {
    result = await buildDryRunPlan(definition, {
      payload,
      availableToolNames: deps.availableToolNames,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    jsonResponse(res, 500, { error: `Dry-run failed: ${msg}` });
    return;
  }

  jsonResponse(res, result.pass ? 200 : 422, result);
}
