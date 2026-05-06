import { formatRunId } from "./run-io.js";
import { maybeStartNext, type WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";


export type WorkflowRuntimeRunsControlState = WorkflowRuntimeDispatchState;

export function abortActiveRuns(state: WorkflowRuntimeRunsControlState): { aborted: number } {
  const count = state.activeRuns.size;
  for (const { abortController } of state.activeRuns.values()) {
    abortController.abort();
  }
  return { aborted: count };
}

export function abortActiveRun(
  state: WorkflowRuntimeRunsControlState,
  runId: string,
): { ok: boolean; notFound?: boolean; queued?: boolean } {
  const runtimeState = state.store.readState();
  const activeEntry = (runtimeState.activeRuns ?? []).find((r) => r.runId === runId);
  if (activeEntry) {
    const inMemory = state.activeRuns.get(activeEntry.workflow);
    if (inMemory) {
      inMemory.abortController.abort();
      return { ok: true };
    }
  }
  const isQueued = state.wfQueue.getRuns().some((r) => r.runId === runId);
  if (isQueued) return { ok: false, queued: true };
  return { ok: false, notFound: true };
}

export function enqueuePendingRun(
  state: WorkflowRuntimeRunsControlState,
  name: string,
  tags?: string[],
  extraPayload?: Record<string, unknown>,
): {
  ok: boolean;
  queued?: string;
  runId?: string;
  alreadyQueued?: boolean;
  error?: string;
} {
  const definition = state.definitions.find((d) => d.name === name);
  if (!definition) return { ok: false, error: `Unknown workflow "${name}"` };
  if (!definition.enabled) return { ok: false, error: `Workflow "${name}" is disabled` };
  const runtimeState = state.store.readState();
  if (runtimeState.pendingRuns.some((r) => r.workflowName === name)) {
    return { ok: false, alreadyQueued: true };
  }
  const now = Date.now();
  const runId = formatRunId(name);
  const trigger = {
    event: "manual",
    payload: {
      ...(extraPayload ?? {}),
      triggeredAt: new Date().toISOString(),
      _runId: runId,
      ...(tags && tags.length > 0 && { tags }),
    },
  };
  state.store.setPendingRuns([
    ...runtimeState.pendingRuns,
    { runId, workflowName: name, trigger, enqueuedAtMs: now, notBeforeMs: now },
  ]);
  maybeStartNext(state);
  return { ok: true, queued: name, runId };
}

export function enqueueWebhookRun(
  state: WorkflowRuntimeRunsControlState,
  name: string,
  webhookPayload: { body: unknown; headers: Record<string, string>; timestamp: string },
): { ok: boolean; runId?: string; alreadyRunning?: boolean; error?: string } {
  const definition = state.definitions.find((d) => d.name === name);
  if (!definition) return { ok: false, error: `Unknown workflow "${name}"` };
  if (!definition.enabled) return { ok: false, error: `Workflow "${name}" is disabled` };
  if (!definition.triggers.some((t) => t.webhook === true)) {
    return { ok: false, error: `Workflow "${name}" has no webhook trigger` };
  }
  if (state.activeRuns.has(name)) return { ok: false, alreadyRunning: true };
  const runId = formatRunId(name);
  const now = Date.now();
  const trigger: WorkflowRunTrigger = {
    event: "webhook",
    payload: { ...webhookPayload, _runId: runId },
  };
  const runtimeState = state.store.readState();
  state.store.setPendingRuns([
    ...runtimeState.pendingRuns,
    { runId, workflowName: name, trigger, enqueuedAtMs: now, notBeforeMs: now },
  ]);
  maybeStartNext(state);
  return { ok: true, runId };
}

export function cancelQueuedRun(
  state: WorkflowRuntimeRunsControlState,
  runId: string,
): { ok: boolean; notFound?: boolean; active?: boolean } {
  const { cancelled } = state.wfQueue.cancel(runId);
  if (cancelled) return { ok: true };
  const runtimeState = state.store.readState();
  const isActive = (runtimeState.activeRuns ?? []).some((r) => r.runId === runId);
  if (isActive) return { ok: false, active: true };
  return { ok: false, notFound: true };
}
