import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
  WorkflowRunDetail,
} from "#core/daemon/daemon-control.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import { buildOperatorTriggerRequestBody } from "#core/workflow/operator-trigger.js";
import { buildRetriggerOptions } from "#core/workflow/retrigger.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { line, span } from "#modules/rendering/primitives.js";
import { printToStderr } from "#modules/rendering/transport.js";
import type { WorkflowTriggerOptions } from "../client.js";
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

  const run = await loadRunThroughDaemon(req, res, link, runId);
  if (run === null) {
    return;
  }

  if (run.status !== "failed" && run.status !== "interrupted") {
    jsonResponse(res, 409, { error: `Run "${runId}" cannot be retried (status: ${run.status})` });
    return;
  }

  await enqueueThroughDaemon(
    req,
    res,
    link,
    run.workflow,
    buildRetriggerOptions("retry", runId, run.workflow, {
      event: run.triggerEvent,
      schemaRef: run.triggerSchemaRef,
      payload: run.triggerPayload ?? {},
    }),
  );
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

  const original = await loadRunThroughDaemon(req, res, link, runId);
  if (original === null) {
    return;
  }

  if (original.status === "running") {
    jsonResponse(res, 409, { error: `Run "${runId}" is still running. Cannot replay an active run.` });
    return;
  }

  await enqueueThroughDaemon(
    req,
    res,
    link,
    original.workflow,
    buildRetriggerOptions("replay", runId, original.workflow, {
      event: original.triggerEvent,
      schemaRef: original.triggerSchemaRef,
      payload: original.triggerPayload ?? {},
    }),
  );
}

async function loadRunThroughDaemon(
  req: IncomingMessage,
  res: ServerResponse,
  link: DaemonTransport,
  runId: string,
): Promise<WorkflowRunDetail | null> {
  let response: Response;
  try {
    response = await link.fetchRaw(
      scopedDaemonPath(req, `/workflow/runs/${encodeURIComponent(runId)}`),
    );
  } catch (error) {
    reportWorkflowTransportFailure("read run", error);
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return null;
  }
  if (response.status === 404) {
    jsonResponse(res, 404, { error: `Run "${runId}" not found` });
    return null;
  }
  if (!response.ok) {
    jsonResponse(res, response.status, await response.json());
    return null;
  }
  return response.json() as Promise<WorkflowRunDetail>;
}

async function enqueueThroughDaemon(
  req: IncomingMessage,
  res: ServerResponse,
  link: DaemonTransport,
  workflowName: string,
  options: WorkflowTriggerOptions,
): Promise<void> {
  await sendTriggerThroughDaemon(
    req,
    res,
    link,
    buildOperatorTriggerRequestBody(workflowName, options),
  );
}

async function sendTriggerThroughDaemon(
  req: IncomingMessage,
  res: ServerResponse,
  link: DaemonTransport,
  body: Record<string, unknown>,
): Promise<void> {
  let response: Response;
  try {
    response = await link.fetchRaw(scopedDaemonPath(req, "/workflow/trigger"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    reportWorkflowTransportFailure("enqueue workflow", error);
    jsonResponse(res, 503, { error: "Daemon not reachable" });
    return;
  }
  const result = await response.json() as Record<string, unknown>;
  jsonResponse(res, response.status, result);
}

function scopedDaemonPath(req: IncomingMessage, path: string): string {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const scopeQuery = new URLSearchParams();
  for (const key of ["scopeId", "projectId"] as const) {
    const value = requestUrl.searchParams.get(key);
    if (value !== null) scopeQuery.set(key, value);
  }
  const query = scopeQuery.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

function reportWorkflowTransportFailure(operation: string, error: unknown): void {
  printToStderr(
    line(
      span(
        `workflow ${operation} transport failed: ${error instanceof Error ? error.message : String(error)}`,
        "warn",
      ),
    ),
  );
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

  await sendTriggerThroughDaemon(req, res, link, body);
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
