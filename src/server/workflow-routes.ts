import { existsSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { WorkflowRunStore } from "../workflow/run-store.js";
import type { WorkflowQueuedRun } from "../workflow/run-types.js";
import { jsonResponse, readBody } from "./session-pool.js";

const PAUSE_SIGNAL = "dispatch-paused";

export function handleWorkflowStatus(
  res: ServerResponse,
  store = new WorkflowRunStore(),
): void {
  const state = store.readState();
  const paused = existsSync(join(store.rootDir, PAUSE_SIGNAL));
  jsonResponse(res, 200, {
    activeRuns: state.activeRuns ?? [],
    queueLength: state.pendingRuns.length,
    completedRuns: state.completedRuns,
    workflows: state.workflows,
    paused,
  });
}

export function handleWorkflowPause(
  res: ServerResponse,
  store = new WorkflowRunStore(),
): void {
  const pausePath = join(store.rootDir, PAUSE_SIGNAL);
  if (existsSync(pausePath)) {
    jsonResponse(res, 200, { ok: true, paused: true, already: true });
    return;
  }
  writeFileSync(pausePath, "");
  jsonResponse(res, 200, { ok: true, paused: true });
}

export function handleWorkflowResume(
  res: ServerResponse,
  store = new WorkflowRunStore(),
): void {
  const pausePath = join(store.rootDir, PAUSE_SIGNAL);
  if (!existsSync(pausePath)) {
    jsonResponse(res, 200, { ok: true, paused: false, already: true });
    return;
  }
  rmSync(pausePath);
  jsonResponse(res, 200, { ok: true, paused: false });
}

export async function handleWorkflowTrigger(
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

  const name = body.name as string | undefined;
  if (!name || typeof name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    jsonResponse(res, 400, { error: "name must be a non-empty alphanumeric string" });
    return;
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
