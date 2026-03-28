import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkflowLiveStatus } from "../scheduler/daemon-control.js";
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

  if (client) {
    const result = await client.trigger(name);
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
  const trigger = { event: "manual", payload: { triggeredAt: new Date().toISOString() } };
  const queued: WorkflowQueuedRun = {
    workflowName: name,
    trigger,
    enqueuedAtMs: now,
    notBeforeMs: now,
  };
  store.setPendingRuns([...state.pendingRuns, queued]);
  jsonResponse(res, 200, { ok: true, queued: name });
}
