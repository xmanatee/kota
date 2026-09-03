import type { WorkflowRunDetail } from "#core/daemon/daemon-control.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import {
  type JsonSchemaObject,
  type JsonSchemaValue,
  validateJsonSchemaValue,
} from "#core/util/json-schema-validator.js";
import { buildOperatorTriggerRequestBody } from "#core/workflow/operator-trigger.js";
import { buildRetriggerOptions } from "#core/workflow/retrigger.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import type { UiActionExecuteInput } from "./client.js";
import type {
  UiAction,
  UiActionExecutionResult,
  UiClientNamespaceExecutor,
  UiJsonValue,
  UiRouteExecutor,
  UiSurfaceBundle,
} from "./operator-ui.js";
import {
  executeScopesUiAction,
  executeUiAction,
  findUiAction,
} from "./operator-ui.js";
import { buildScopesDaemonHandler } from "./scopes-daemon.js";
import {
  scopedUiActionClient,
  scopedUiActionPath,
  stringUiParameter,
} from "./ui-setup-route.js";

function routeForUiNamespaceOperation(
  operation: Parameters<UiClientNamespaceExecutor>[0],
  parameters: UiJsonValue | undefined,
): { method: string; path: string; body?: UiJsonValue; message: string } | null {
  const staticRoutes: Record<string, { method: string; path: string; message: string }> = {
    "workflow:status": { method: "GET", path: "/workflow/status", message: "Workflow status loaded." },
    "workflow:pause": { method: "POST", path: "/workflow/pause", message: "Workflow dispatch paused." },
    "workflow:resume": { method: "POST", path: "/workflow/resume", message: "Workflow dispatch resumed." },
    "workflow:abort": { method: "POST", path: "/workflow/abort", message: "Active workflow runs aborted." },
    "workflow:listDefinitions": { method: "GET", path: "/workflow/definitions", message: "Workflow definitions loaded." },
    "sessions:list": { method: "GET", path: "/sessions", message: "Live sessions loaded." },
    "modules:list": { method: "GET", path: "/modules", message: "Modules loaded." },
    "agents:list": { method: "GET", path: "/agents", message: "Agents loaded." },
    "setup:list": { method: "GET", path: "/setup/requirements", message: "Setup requirements loaded." },
    "memory:list": { method: "GET", path: "/api/memory?limit=10", message: "Memory loaded." },
    "knowledge:list": { method: "GET", path: "/api/knowledge", message: "Knowledge loaded." },
    "history:list": { method: "GET", path: "/history?limit=10", message: "History loaded." },
  };
  const staticRoute = staticRoutes[`${operation.namespace}:${operation.method}`];
  if (staticRoute) return staticRoute;
  if (operation.namespace === "workflow" && operation.method === "abortRun") {
    const runId = stringUiParameter(parameters, "runId");
    return runId
      ? { method: "POST", path: `/workflow/runs/${encodeURIComponent(runId)}/abort`, message: `Run ${runId} aborted.` }
      : { method: "POST", path: "/workflow/runs//abort", message: "runId is required." };
  }
  if (operation.namespace === "workflow" && operation.method === "cancelRun") {
    const runId = stringUiParameter(parameters, "runId");
    return runId
      ? { method: "DELETE", path: `/workflow/runs/${encodeURIComponent(runId)}`, message: `Queued run ${runId} cancelled.` }
      : { method: "DELETE", path: "/workflow/runs/", message: "runId is required." };
  }
  return null;
}

async function executeDaemonRunFollowUp(
  link: DaemonTransport,
  scopeId: string,
  parameters: UiJsonValue | undefined,
  action: "retry" | "replay" | "resume",
): Promise<UiActionExecutionResult> {
  const runId = stringUiParameter(parameters, "runId");
  if (!runId) return { ok: false, reason: "invalid-input", message: "runId is required." };
  const fromStep = stringUiParameter(parameters, "fromStep");
  if (action === "resume" && !fromStep) {
    return { ok: false, reason: "invalid-input", message: "fromStep is required." };
  }
  const run = await link.request<WorkflowRunDetail>(
    "GET",
    scopedUiActionPath(`/workflow/runs/${encodeURIComponent(runId)}`, scopeId),
    undefined,
    { timeoutMs: 10_000 },
  );
  if (run === null) return { ok: false, reason: "not_found", message: `Run ${runId} was not found.` };
  if (run.status === "running") return { ok: false, reason: "active", message: `Run ${runId} is still running.` };
  if (action === "retry" && (run.status === "success" || run.status === "completed-with-warnings")) {
    return { ok: false, reason: "invalid-input", message: `Run ${runId} completed successfully; use replay instead.` };
  }
  const options = action === "resume"
    ? {
        event: "resume",
        payload: {
          resumedFromRunId: runId,
          resumeFromStep: fromStep,
          resumeTriggeredAt: new Date().toISOString(),
        },
      }
    : buildRetriggerOptions(action, runId, run.workflow, {
        event: run.triggerEvent,
        schemaRef: run.triggerSchemaRef,
        payload: run.triggerPayload ?? {},
      });
  const result = await link.request<UiJsonValue>(
    "POST",
    scopedUiActionPath("/workflow/trigger", scopeId),
    buildOperatorTriggerRequestBody(run.workflow, options),
    { timeoutMs: 10_000 },
  );
  if (result === null) {
    return { ok: false, reason: "unavailable", message: `Unable to queue ${action} for run ${runId}.` };
  }
  return {
    ok: true,
    message: action === "retry"
      ? `Queued retry from ${runId}.`
      : action === "replay"
        ? `Queued replay from ${runId}.`
        : `Queued resume from ${runId}.`,
  };
}

export function daemonUiNamespaceExecutor(
  link: DaemonTransport,
  scopeId: string,
): UiClientNamespaceExecutor {
  return async (operation, parameters) => {
    if (operation.namespace === "daemonOps" && operation.method === "start") {
      return { ok: true, message: "Daemon already running." };
    }
    if (operation.namespace === "workflow" && operation.method === "retryRun") {
      return executeDaemonRunFollowUp(link, scopeId, parameters, "retry");
    }
    if (operation.namespace === "workflow" && operation.method === "replayRun") {
      return executeDaemonRunFollowUp(link, scopeId, parameters, "replay");
    }
    if (operation.namespace === "workflow" && operation.method === "resumeRun") {
      return executeDaemonRunFollowUp(link, scopeId, parameters, "resume");
    }
    if (operation.namespace === "scopes") {
      const result = await executeScopesUiAction(
        buildScopesDaemonHandler(link),
        operation.method,
        parameters,
      );
      if (result) return result;
    }
    const route = routeForUiNamespaceOperation(operation, parameters);
    if (!route) return null;
    if (route.path === "/workflow/runs//abort" || route.path === "/workflow/runs/") {
      return { ok: false, reason: "invalid-input", message: route.message };
    }
    const result = await link.request<UiJsonValue>(
      route.method,
      scopedUiActionPath(route.path, scopeId),
      route.body,
      { timeoutMs: 10_000 },
    );
    return result === null
      ? { ok: false, reason: "unavailable", message: `${route.method} ${route.path} is unavailable.` }
      : { ok: true, message: route.message };
  };
}

export async function executeActionFromBundle(args: {
  bundle: UiSurfaceBundle;
  input: UiActionExecuteInput;
  client?: KotaClient;
  clientNamespaceExecutor?: (action: UiAction) => UiClientNamespaceExecutor;
  routeExecutor: (action: UiAction, client: KotaClient | undefined) => UiRouteExecutor;
}): Promise<UiActionExecutionResult> {
  const action = findUiAction(args.bundle, args.input.surfaceId, args.input.actionId);
  if (!action) {
    return {
      ok: false,
      reason: "not_found",
      message: `No UI action ${args.input.surfaceId}/${args.input.actionId} exists in the shared surface bundle.`,
    };
  }
  if (action.parameters === undefined && args.input.parameters !== undefined) {
    return {
      ok: false,
      reason: "invalid-input",
      message: `${action.label} does not accept parameters.`,
    };
  }
  if (action.parameters !== undefined) {
    const validationError = validateJsonSchemaValue(
      action.parameters.schema as unknown as JsonSchemaObject,
      (args.input.parameters ?? {}) as JsonSchemaValue,
      "parameters",
    );
    if (validationError !== null) {
      return {
        ok: false,
        reason: "invalid-input",
        message: `Invalid action parameters: ${validationError}`,
      };
    }
  }
  if (action.confirmation.mode === "required" && args.input.confirmed !== true) {
    return {
      ok: false,
      reason: "confirmation_required",
      message: `${action.label} requires explicit confirmation.`,
    };
  }
  const client = args.client ? scopedUiActionClient(args.client, action.scopeId) : undefined;
  return executeUiAction({
    action,
    client,
    clientNamespaceExecutor: args.clientNamespaceExecutor?.(action),
    parameters: args.input.parameters,
    routeExecutor: args.routeExecutor(action, client),
  });
}
