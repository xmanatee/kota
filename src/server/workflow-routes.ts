import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkflowDefinitionSummary, WorkflowLiveStatus } from "../scheduler/daemon-control.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import type { WorkflowQueuedRun } from "../workflow/run-types.js";
import type { DaemonControlClient } from "./daemon-client.js";
import { jsonResponse, readBody } from "./session-pool.js";

const EMPTY_WORKFLOW_STATUS: WorkflowLiveStatus = {
  activeRuns: [],
  pendingRuns: [],
  queueLength: 0,
  completedRuns: 0,
  workflows: {},
  paused: false,
};

export async function handleWorkflowStatus(
  res: ServerResponse,
  client: DaemonControlClient | null = null,
): Promise<void> {
  if (!client) {
    jsonResponse(res, 200, EMPTY_WORKFLOW_STATUS);
    return;
  }
  const status = await client.getWorkflowStatus();
  jsonResponse(res, 200, status ?? EMPTY_WORKFLOW_STATUS);
}

export async function handleWorkflowDefinitions(
  res: ServerResponse,
  client: DaemonControlClient | null = null,
): Promise<void> {
  if (!client) {
    jsonResponse(res, 200, { definitions: [] as WorkflowDefinitionSummary[] });
    return;
  }
  const result = await client.getWorkflowDefinitions();
  jsonResponse(res, 200, result ?? { definitions: [] });
}

export async function handleWorkflowPause(
  res: ServerResponse,
  client: DaemonControlClient | null = null,
): Promise<void> {
  if (!client) {
    jsonResponse(res, 503, { error: "Daemon not running" });
    return;
  }
  const result = await client.pause();
  if (!result) {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  jsonResponse(res, 200, result);
}

export async function handleWorkflowResume(
  res: ServerResponse,
  client: DaemonControlClient | null = null,
): Promise<void> {
  if (!client) {
    jsonResponse(res, 503, { error: "Daemon not running" });
    return;
  }
  const result = await client.resume();
  if (!result) {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  jsonResponse(res, 200, result);
}

export async function handleWorkflowAbort(
  res: ServerResponse,
  client: DaemonControlClient | null = null,
): Promise<void> {
  if (!client) {
    jsonResponse(res, 503, { error: "Daemon not running" });
    return;
  }
  const result = await client.abort();
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
  client: DaemonControlClient | null = null,
): Promise<void> {
  if (!client) {
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

export async function handleWorkflowCancel(
  res: ServerResponse,
  runId: string,
  client: DaemonControlClient | null = null,
): Promise<void> {
  if (!client) {
    jsonResponse(res, 503, { error: "Daemon not running" });
    return;
  }
  if (!runId || runId.includes("/") || runId.includes("..")) {
    jsonResponse(res, 400, { error: "Invalid run ID" });
    return;
  }
  const result = await client.cancelRun(runId);
  if (!result) {
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  if (result.notFound) {
    jsonResponse(res, 404, { error: `Run "${runId}" not found` });
    return;
  }
  if (result.active) {
    jsonResponse(res, 409, { error: `Run "${runId}" is already active and cannot be cancelled` });
    return;
  }
  jsonResponse(res, 200, { ok: true });
}

export async function handleWorkflowTrigger(
  req: IncomingMessage,
  res: ServerResponse,
  store = new WorkflowRunStore(),
  client: DaemonControlClient | null = null,
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

  if (client) {
    const result = await client.trigger(name, tags);
    if (result) {
      if (result.alreadyQueued) {
        jsonResponse(res, 409, { error: `Workflow "${name}" is already queued` });
        return;
      }
      jsonResponse(res, 200, { ok: true, queued: result.queued ?? name });
      return;
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
