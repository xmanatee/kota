import type { IncomingMessage, ServerResponse } from "node:http";
import { isEventSchemaReference } from "#core/events/event-bus-envelope-types.js";
import type { EventSchemaReference } from "#core/events/event-bus-types.js";
import type { WorkflowEnqueueOptions } from "#core/workflow/operator-trigger.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { jsonResponse, readBody, resolveScopeIdParam } from "./daemon-control-utils.js";

export function handleGetWorkflowStatus(handle: DaemonControlHandle, res: ServerResponse, url: URL): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  jsonResponse(res, 200, handle.getWorkflowLiveStatus(scope.scopeId));
}

export function handleGetWorkflowDefinitions(handle: DaemonControlHandle, res: ServerResponse, url: URL): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  jsonResponse(res, 200, { definitions: handle.getWorkflowDefinitions(scope.scopeId) });
}

export function handleListWorkflowRuns(
  handle: DaemonControlHandle,
  res: ServerResponse,
  url: URL,
): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  const workflow = url.searchParams.get("workflow") ?? undefined;
  const tag = url.searchParams.get("tag") ?? undefined;
  const causedByRunId = url.searchParams.get("causedByRunId") ?? undefined;
  const rawLimit = url.searchParams.has("limit") ? Number.parseInt(url.searchParams.get("limit")!, 10) : 20;
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 200);
  jsonResponse(res, 200, {
    runs: handle.listWorkflowRuns({ workflow, limit, tag, causedByRunId, scopeId: scope.scopeId }),
  });
}

export function handleGetWorkflowRun(
  handle: DaemonControlHandle,
  res: ServerResponse,
  params: Record<string, string>,
  url: URL,
): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  let runId: string;
  try {
    runId = validateWorkflowRunId(params.id, "Workflow run route parameter");
  } catch {
    jsonResponse(res, 400, { error: "Invalid workflow run id" });
    return;
  }
  const run = handle.getWorkflowRun(runId, scope.scopeId);
  if (!run) {
    jsonResponse(res, 404, { error: "Run not found" });
    return;
  }
  jsonResponse(res, 200, run);
}

export function handlePauseWorkflow(handle: DaemonControlHandle, res: ServerResponse, url: URL): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  const { already } = handle.pauseWorkflowDispatch(scope.scopeId);
  jsonResponse(res, 200, { ok: true, paused: true, ...(already && { already: true }) });
}

export function handleResumeWorkflow(handle: DaemonControlHandle, res: ServerResponse, url: URL): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  const options = url.searchParams.get("retryAgent") === "true"
    ? { retryAgent: true }
    : undefined;
  const { already, agentBackoffCleared } =
    handle.resumeWorkflowDispatch(scope.scopeId, options);
  jsonResponse(res, 200, {
    ok: true,
    paused: false,
    ...(already && { already: true }),
    ...(agentBackoffCleared && { agentBackoffCleared }),
  });
}

export function handleAbortWorkflow(handle: DaemonControlHandle, res: ServerResponse, url: URL): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  const { aborted } = handle.abortActiveRuns(scope.scopeId);
  jsonResponse(res, 200, { ok: true, aborted });
}

export function handleAbortWorkflowRun(
  handle: DaemonControlHandle,
  res: ServerResponse,
  params: Record<string, string>,
  url: URL,
): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  const result = handle.abortActiveRun(params.id, scope.scopeId);
  if (result.notFound) {
    jsonResponse(res, 404, { error: "Run not found" });
    return;
  }
  if (result.queued) {
    jsonResponse(res, 409, { error: "Run is queued, not active; use DELETE /workflow/runs/:id to cancel it" });
    return;
  }
  jsonResponse(res, 200, { ok: true });
}

export function handleReloadWorkflow(handle: DaemonControlHandle, res: ServerResponse, url: URL): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  const { count } = handle.reloadWorkflowDefinitions(scope.scopeId);
  jsonResponse(res, 200, { ok: true, count });
}

export function handleReloadConfig(handle: DaemonControlHandle, res: ServerResponse): void {
  handle.reloadConfig().then(({ workflows, changedModules, sessionGuardrails }) => {
    jsonResponse(res, 200, { ok: true, workflows, changedModules, sessionGuardrails });
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    jsonResponse(res, 500, { error: `Reload failed: ${msg}` });
  });
}

export function handleCancelWorkflowRun(
  handle: DaemonControlHandle,
  res: ServerResponse,
  params: Record<string, string>,
  url: URL,
): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  const result = handle.cancelQueuedRun(params.id, scope.scopeId);
  if (result.notFound) {
    jsonResponse(res, 404, { error: "Run not found" });
    return;
  }
  if (result.active) {
    jsonResponse(res, 409, { error: "Run is active; use POST /workflow/abort to cancel active runs" });
    return;
  }
  if (result.preserved) {
    jsonResponse(res, 409, {
      error: "Run sandbox contains unintegrated or unverifiable work and was preserved",
      blockers: result.blockers ?? [],
    });
    return;
  }
  jsonResponse(res, 200, { ok: true });
}

export function handleDisableWorkflow(
  handle: DaemonControlHandle,
  res: ServerResponse,
  params: Record<string, string>,
  url: URL,
): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  const result = handle.disableWorkflow(params.name, scope.scopeId);
  if (result.notFound) {
    jsonResponse(res, 404, { error: `Workflow "${params.name}" not found` });
    return;
  }
  jsonResponse(res, 200, { ok: true, name: params.name, runtimeEnabled: false });
}

export function handleEnableWorkflow(
  handle: DaemonControlHandle,
  res: ServerResponse,
  params: Record<string, string>,
  url: URL,
): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  const result = handle.enableWorkflow(params.name, scope.scopeId);
  if (result.notFound) {
    jsonResponse(res, 404, { error: `Workflow "${params.name}" not found` });
    return;
  }
  jsonResponse(res, 200, { ok: true, name: params.name, runtimeEnabled: true });
}

export function handleTriggerWorkflow(
  handle: DaemonControlHandle,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): void {
  const scope = resolveScopeIdParam(handle, url);
  if (!scope.ok) {
    jsonResponse(res, scope.status, scope.error);
    return;
  }
  readBody(req)
    .then((buf) => {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(buf.toString()) as Record<string, unknown>;
      } catch {
        jsonResponse(res, 400, { error: "Invalid JSON body" });
        return;
      }
      const name = body.name;
      if (!name || typeof name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(name)) {
        jsonResponse(res, 400, { error: "name must be a non-empty alphanumeric string" });
        return;
      }
      const options = parseWorkflowEnqueueOptions(body, name);
      if (!options.ok) {
        jsonResponse(res, 400, { error: options.error });
        return;
      }
      const result = handle.enqueuePendingRun(name, options.value, scope.scopeId);
      if (result.alreadyQueued) {
        jsonResponse(res, 409, { error: `Workflow "${name}" is already queued` });
        return;
      }
      if (result.reason === "scope_not_hosted") {
        jsonResponse(res, 409, {
          error: result.error,
          reason: result.reason,
          scopeId: result.scopeId,
          state: result.state,
        });
        return;
      }
      if (!result.ok) {
        jsonResponse(res, 400, { error: result.error ?? "Failed to enqueue workflow" });
        return;
      }
      jsonResponse(res, 200, { ok: true, queued: result.queued, runId: result.runId });
    })
    .catch(() => jsonResponse(res, 500, { error: "Internal error" }));
}

function parseWorkflowEnqueueOptions(
  body: Record<string, unknown>,
  workflowName: string,
): { ok: true; value: WorkflowEnqueueOptions } | { ok: false; error: string } {
  if (body.tags !== undefined && (!Array.isArray(body.tags) || !body.tags.every((tag) => typeof tag === "string"))) {
    return { ok: false, error: "tags must be an array of strings" };
  }
  if (body.payload !== undefined && (body.payload === null || typeof body.payload !== "object" || Array.isArray(body.payload))) {
    return { ok: false, error: "payload must be an object" };
  }
  if (body.event !== undefined && (typeof body.event !== "string" || body.event.trim().length === 0)) {
    return { ok: false, error: "event must be a non-empty string" };
  }
  if (body.schemaRef !== undefined && body.schemaRef !== null && !isEventSchemaReference(body.schemaRef)) {
    return { ok: false, error: "schemaRef must be null or a name/version object" };
  }
  if (body.runId !== undefined) {
    if (typeof body.runId !== "string") return { ok: false, error: "runId must be a string" };
    try {
      validateWorkflowRunId(body.runId, `Workflow "${workflowName}" enqueue`);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
  if (
    body.notBeforeMs !== undefined &&
    (typeof body.notBeforeMs !== "number" || !Number.isFinite(body.notBeforeMs) || body.notBeforeMs < 0)
  ) {
    return { ok: false, error: "notBeforeMs must be a non-negative finite number" };
  }

  return {
    ok: true,
    value: {
      ...(body.tags !== undefined ? { tags: body.tags as string[] } : {}),
      ...(body.payload !== undefined ? { payload: body.payload as Record<string, unknown> } : {}),
      ...(body.event !== undefined ? { event: body.event as string } : {}),
      ...(body.schemaRef !== undefined ? { schemaRef: body.schemaRef as EventSchemaReference | null } : {}),
      ...(body.runId !== undefined ? { runId: body.runId as string } : {}),
      ...(body.notBeforeMs !== undefined ? { notBeforeMs: body.notBeforeMs as number } : {}),
    },
  };
}
