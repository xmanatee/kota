import type { IncomingMessage, ServerResponse } from "node:http";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { jsonResponse, readBody } from "./daemon-control-utils.js";

export function handleGetWorkflowStatus(handle: DaemonControlHandle, res: ServerResponse): void {
  jsonResponse(res, 200, handle.getWorkflowLiveStatus());
}

export function handleGetWorkflowDefinitions(handle: DaemonControlHandle, res: ServerResponse): void {
  jsonResponse(res, 200, { definitions: handle.getWorkflowDefinitions() });
}

export function handleListWorkflowRuns(
  handle: DaemonControlHandle,
  res: ServerResponse,
  url: URL,
): void {
  const workflow = url.searchParams.get("workflow") ?? undefined;
  const tag = url.searchParams.get("tag") ?? undefined;
  const causedByRunId = url.searchParams.get("causedByRunId") ?? undefined;
  const rawLimit = url.searchParams.has("limit") ? Number.parseInt(url.searchParams.get("limit")!, 10) : 20;
  const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 200);
  jsonResponse(res, 200, { runs: handle.listWorkflowRuns(workflow, limit, tag, causedByRunId) });
}

export function handleGetWorkflowRun(
  handle: DaemonControlHandle,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  const run = handle.getWorkflowRun(params.id);
  if (!run) {
    jsonResponse(res, 404, { error: "Run not found" });
    return;
  }
  jsonResponse(res, 200, run);
}

export function handlePauseWorkflow(handle: DaemonControlHandle, res: ServerResponse): void {
  const { already } = handle.pauseWorkflowDispatch();
  jsonResponse(res, 200, { ok: true, paused: true, ...(already && { already: true }) });
}

export function handleResumeWorkflow(handle: DaemonControlHandle, res: ServerResponse): void {
  const { already } = handle.resumeWorkflowDispatch();
  jsonResponse(res, 200, { ok: true, paused: false, ...(already && { already: true }) });
}

export function handleAbortWorkflow(handle: DaemonControlHandle, res: ServerResponse): void {
  const { aborted } = handle.abortActiveRuns();
  jsonResponse(res, 200, { ok: true, aborted });
}

export function handleAbortWorkflowRun(
  handle: DaemonControlHandle,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  const result = handle.abortActiveRun(params.id);
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

export function handleReloadWorkflow(handle: DaemonControlHandle, res: ServerResponse): void {
  const { count } = handle.reloadWorkflowDefinitions();
  jsonResponse(res, 200, { ok: true, count });
}

export function handleCancelWorkflowRun(
  handle: DaemonControlHandle,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  const result = handle.cancelQueuedRun(params.id);
  if (result.notFound) {
    jsonResponse(res, 404, { error: "Run not found" });
    return;
  }
  if (result.active) {
    jsonResponse(res, 409, { error: "Run is active; use POST /workflow/abort to cancel active runs" });
    return;
  }
  jsonResponse(res, 200, { ok: true });
}

export function handleTriggerWorkflow(
  handle: DaemonControlHandle,
  req: IncomingMessage,
  res: ServerResponse,
): void {
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
      const tags =
        Array.isArray(body.tags) && (body.tags as unknown[]).every((t) => typeof t === "string")
          ? (body.tags as string[])
          : undefined;
      const extraPayload =
        body.payload !== undefined && body.payload !== null && typeof body.payload === "object" && !Array.isArray(body.payload)
          ? (body.payload as Record<string, unknown>)
          : undefined;
      const result = handle.enqueuePendingRun(name, tags, extraPayload);
      if (result.alreadyQueued) {
        jsonResponse(res, 409, { error: `Workflow "${name}" is already queued` });
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
