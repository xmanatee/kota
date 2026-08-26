import { buildRetriggerOptions } from "#core/workflow/retrigger.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import { executeCapabilityUiAction } from "./operator-ui-capability-actions.js";
import type {
  UiAction,
  UiActionOperation,
  UiJsonValue,
  UiSurfaceBundle,
} from "./operator-ui-types.js";

export type UiActionExecutionResult =
  | { ok: true; message: string }
  | { ok: false; reason: string; message: string };

export type UiRouteExecutor = (
  operation: Extract<UiActionOperation, { kind: "daemon-route" }>,
  parameters?: UiJsonValue,
) => Promise<UiActionExecutionResult>;

export type UiClientNamespaceExecutor = (
  operation: Extract<UiActionOperation, { kind: "client-namespace" }>,
  parameters?: UiJsonValue,
) => Promise<UiActionExecutionResult | null>;

export function findUiAction(
  bundle: UiSurfaceBundle,
  surfaceId: string,
  actionId: string,
): UiAction | null {
  const surface = bundle.surfaces.find((candidate) => candidate.surfaceId === surfaceId);
  if (!surface) return null;
  return surface.actions.find((candidate) => candidate.actionId === actionId) ?? null;
}

function objectParameters(parameters: UiJsonValue | undefined): { readonly [key: string]: UiJsonValue } | null {
  if (parameters === undefined || parameters === null || Array.isArray(parameters) || typeof parameters !== "object") {
    return null;
  }
  return parameters;
}

function stringParameter(
  parameters: UiJsonValue | undefined,
  key: string,
): string | undefined {
  const obj = objectParameters(parameters);
  const value = obj?.[key];
  return typeof value === "string" ? value : undefined;
}

function booleanParameter(
  parameters: UiJsonValue | undefined,
  key: string,
): boolean {
  const obj = objectParameters(parameters);
  const value = obj?.[key];
  return typeof value === "boolean" ? value : false;
}

async function triggerRunFollowUp(args: {
  client: KotaClient;
  runId: string;
  kind: "retry" | "replay" | "resume";
  fromStep?: string;
}): Promise<UiActionExecutionResult> {
  const found = await args.client.workflow.getRun(args.runId);
  if (!found.found) return { ok: false, reason: "not_found", message: `Run ${args.runId} was not found.` };
  const run = found.run;
  if (run.status === "running") {
    return { ok: false, reason: "active", message: `Run ${args.runId} is still running.` };
  }
  if (args.kind === "retry" && (run.status === "success" || run.status === "completed-with-warnings")) {
    return { ok: false, reason: "invalid-input", message: `Run ${args.runId} completed successfully; use replay instead.` };
  }
  if (args.kind === "resume" && run.status === "success") {
    return { ok: false, reason: "invalid-input", message: `Run ${args.runId} completed successfully; use replay instead.` };
  }
  const options = args.kind === "resume"
    ? {
        event: "resume",
        payload: {
          resumedFromRunId: args.runId,
          resumeFromStep: args.fromStep,
          resumeTriggeredAt: new Date().toISOString(),
        },
      }
    : buildRetriggerOptions(args.kind, args.runId, run.workflow, {
        event: run.triggerEvent,
        schemaRef: run.triggerSchemaRef,
        payload: run.triggerPayload ?? {},
      });
  const result = await args.client.workflow.triggerByName(run.workflow, options);
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      message: result.reason === "daemon_required"
        ? `The daemon must be running to queue ${run.workflow}.`
        : `Workflow ${run.workflow} is already queued.`,
    };
  }
  return {
    ok: true,
    message: args.kind === "retry"
      ? `Queued retry of ${run.workflow} from ${args.runId}.`
      : args.kind === "replay"
        ? `Queued replay of ${run.workflow} from ${args.runId}.`
        : `Queued resume of ${run.workflow} from ${args.fromStep}.`,
  };
}

export async function executeUiAction(args: {
  action: UiAction;
  client?: KotaClient;
  clientNamespaceExecutor?: UiClientNamespaceExecutor;
  parameters?: UiJsonValue;
  routeExecutor?: UiRouteExecutor;
}): Promise<UiActionExecutionResult> {
  const { action, client, clientNamespaceExecutor, parameters, routeExecutor } = args;
  if (action.readiness.state === "disabled") {
    return {
      ok: false,
      reason: action.readiness.reason,
      message: action.readiness.message,
    };
  }
  if (action.operation.kind === "daemon-route") {
    if (!routeExecutor) {
      return {
        ok: false,
        reason: "route-executor-required",
        message: "This UI action requires a daemon-route executor.",
      };
    }
    return routeExecutor(action.operation, parameters);
  }
  const namespaceResult = await clientNamespaceExecutor?.(action.operation, parameters);
  if (namespaceResult) return namespaceResult;
  if (!client) {
    return {
      ok: false,
      reason: "client-required",
      message: "This UI action requires a KotaClient namespace executor.",
    };
  }
  if (action.operation.namespace === "daemonOps" && action.operation.method === "status") {
    const status = await client.daemonOps.status();
    if (status.state === "running") {
      return { ok: true, message: `Daemon running pid ${status.status.pid}.` };
    }
    return { ok: true, message: `Daemon ${status.state.replace(/_/g, " ")}.` };
  }
  if (action.operation.namespace === "scopes" && action.operation.method === "list") {
    const result = await client.scopes.list();
    if (!result.ok) return { ok: false, reason: result.reason, message: "Daemon project registry is unavailable." };
    return { ok: true, message: `${result.scopes.length} project(s) available.` };
  }
  if (action.operation.namespace === "scopes" && action.operation.method === "use") {
    const scopeId = stringParameter(parameters, "scopeId");
    const clear = booleanParameter(parameters, "clear");
    const result = await client.scopes.use(clear ? null : scopeId ?? null);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        message: result.reason === "not_found"
          ? `Unknown scope: ${result.scopeId}.`
          : "Daemon project registry is unavailable.",
      };
    }
    return {
      ok: true,
      message: result.activeScopeId === null
        ? "Active scope cleared."
        : `Active scope set to ${result.activeScopeId}.`,
    };
  }
  if (action.operation.namespace === "workflow" && action.operation.method === "status") {
    const result = await client.workflow.status();
    return { ok: true, message: `${result.activeRuns.length} active, ${result.pendingRuns.length} queued.` };
  }
  if (action.operation.namespace === "workflow" && action.operation.method === "listDefinitions") {
    const result = await client.workflow.listDefinitions();
    return { ok: true, message: `${result.definitions.length} workflow definition(s) available.` };
  }
  if (action.operation.namespace === "workflow" && action.operation.method === "pause") {
    const result = await client.workflow.pause();
    return { ok: true, message: result.already ? "Workflow dispatch was already paused." : "Workflow dispatch paused." };
  }
  if (action.operation.namespace === "workflow" && action.operation.method === "resume") {
    const result = await client.workflow.resume();
    return { ok: true, message: result.already ? "Workflow dispatch was already running." : "Workflow dispatch resumed." };
  }
  if (action.operation.namespace === "workflow" && action.operation.method === "abort") {
    const result = await client.workflow.abort();
    return {
      ok: true,
      message: result.status === "applied"
        ? `${result.count} active run(s) aborted.`
        : `Abort signal written for ${result.runs.length} run(s).`,
    };
  }
  if (action.operation.namespace === "workflow" && action.operation.method === "abortRun") {
    const runId = stringParameter(parameters, "runId");
    if (!runId) return { ok: false, reason: "invalid-input", message: "runId is required." };
    const result = await client.workflow.abortRun(runId);
    if (!result.ok) return { ok: false, reason: result.reason, message: `Unable to abort run ${runId}: ${result.reason}.` };
    return { ok: true, message: `Run ${runId} aborted.` };
  }
  if (action.operation.namespace === "workflow" && action.operation.method === "cancelRun") {
    const runId = stringParameter(parameters, "runId");
    if (!runId) return { ok: false, reason: "invalid-input", message: "runId is required." };
    const result = await client.workflow.cancelRun(runId);
    if (!result.ok) return { ok: false, reason: result.reason, message: `Unable to cancel run ${runId}: ${result.reason}.` };
    return { ok: true, message: `Queued run ${runId} cancelled.` };
  }
  if (action.operation.namespace === "workflow" && action.operation.method === "retryRun") {
    const runId = stringParameter(parameters, "runId");
    if (!runId) return { ok: false, reason: "invalid-input", message: "runId is required." };
    return triggerRunFollowUp({ client, runId, kind: "retry" });
  }
  if (action.operation.namespace === "workflow" && action.operation.method === "replayRun") {
    const runId = stringParameter(parameters, "runId");
    if (!runId) return { ok: false, reason: "invalid-input", message: "runId is required." };
    return triggerRunFollowUp({ client, runId, kind: "replay" });
  }
  if (action.operation.namespace === "workflow" && action.operation.method === "resumeRun") {
    const runId = stringParameter(parameters, "runId");
    const fromStep = stringParameter(parameters, "fromStep");
    if (!runId) return { ok: false, reason: "invalid-input", message: "runId is required." };
    if (!fromStep) return { ok: false, reason: "invalid-input", message: "fromStep is required." };
    return triggerRunFollowUp({ client, runId, kind: "resume", fromStep });
  }
  if (action.operation.namespace === "sessions" && action.operation.method === "list") {
    const result = await client.sessions.list();
    return { ok: true, message: `${result.sessions.length} session(s) available.` };
  }
  if (action.operation.namespace === "modules" && action.operation.method === "list") {
    const result = await client.modules.list();
    return { ok: true, message: `${result.modules.length} module(s) loaded.` };
  }
  if (action.operation.namespace === "agents" && action.operation.method === "list") {
    const result = await client.agents.list();
    return { ok: true, message: `${result.agents.length} agent(s) loaded.` };
  }
  if (action.operation.namespace === "setup" && action.operation.method === "list") {
    const result = await client.setup.list();
    return { ok: true, message: `${result.requirements.length} setup requirement(s) loaded.` };
  }
  if (action.operation.namespace === "memory" && action.operation.method === "list") {
    const result = await client.memory.list({ limit: 10 });
    return { ok: true, message: `${result.entries.length} memory entries loaded.` };
  }
  if (action.operation.namespace === "knowledge" && action.operation.method === "list") {
    const result = await client.knowledge.list();
    return { ok: true, message: `${result.entries.length} knowledge entries loaded.` };
  }
  if (action.operation.namespace === "history" && action.operation.method === "list") {
    const result = await client.history.list({ limit: 10 });
    return { ok: true, message: `${result.conversations.length} conversation(s) loaded.` };
  }
  if (action.operation.namespace === "doctor" && action.operation.method === "fix") {
    const result = await client.doctor.fix();
    return { ok: true, message: `${result.repairs.length} doctor repair(s) processed.` };
  }
  const capabilityResult = await executeCapabilityUiAction({
    client,
    operation: action.operation,
    parameters,
  });
  if (capabilityResult) return capabilityResult;
  return {
    ok: false,
    reason: "unsupported-operation",
    message: `${action.operation.namespace}.${action.operation.method} is not implemented by the CLI UI action executor.`,
  };
}
