import type {
  ScopeOnboardingChoices,
  ScopeOnboardingOperation,
} from "#core/daemon/scope-onboarding.js";
import { decodeScopeOnboardingPlanRequest } from "#core/daemon/scope-onboarding-codec.js";
import { buildRetriggerOptions } from "#core/workflow/retrigger.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import { executeCapabilityUiAction } from "./operator-ui-capability-actions.js";
import type {
  UiAction,
  UiActionOperation,
  UiJsonValue,
  UiSurfaceBundle,
} from "./operator-ui-types.js";
import {
  describeOnboardingInspection,
  describeOnboardingOperation,
  describeOnboardingPlan,
} from "./scope-onboarding-presentation.js";

export type UiActionExecutionPayload = {
  kind: "external-url";
  url: string;
  label: string;
};

export type UiActionExecutionResult =
  | { ok: true; message: string; payload?: UiActionExecutionPayload }
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

function onboardingRequest(
  parameters: UiJsonValue | undefined,
):
  | { ok: true; directoryRoot: string; choices: ScopeOnboardingChoices }
  | { ok: false; result: UiActionExecutionResult } {
  const obj = objectParameters(parameters);
  const writes = obj?.writes;
  if (
    writes === "paths" &&
    (!Array.isArray(obj?.writePaths) || obj.writePaths.length === 0)
  ) {
    return {
      ok: false,
      result: {
        ok: false,
        reason: "invalid-input",
        message: "Selected paths requires at least one allowed path.",
      },
    };
  }
  const canonicalWrites = writes === undefined
    ? undefined
    : writes === "paths"
      ? { mode: writes, paths: obj?.writePaths }
      : typeof writes === "string"
        ? { mode: writes }
        : writes;
  const decoded = decodeScopeOnboardingPlanRequest({
    directoryRoot: obj?.directoryRoot,
    choices: {
      ...(obj?.displayName !== undefined ? { displayName: obj.displayName } : {}),
      ...(obj?.trusted !== undefined ? { trust: obj.trusted } : {}),
      ...(obj?.improvementPosture !== undefined
        ? { improvementPosture: obj.improvementPosture }
        : {}),
      ...(canonicalWrites !== undefined ? { writes: canonicalWrites } : {}),
    },
  });
  if (!decoded.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        reason: "invalid-input",
        message: decoded.error,
      },
    };
  }
  return {
    ok: true,
    directoryRoot: decoded.value.directoryRoot,
    choices: decoded.value.choices,
  };
}

function scopeFailure(
  result: { reason: string; message?: string },
): Extract<UiActionExecutionResult, { ok: false }> {
  return {
    ok: false,
    reason: result.reason,
    message: result.message ?? `Scope operation failed: ${result.reason}.`,
  };
}

function onboardingFailure(result: {
  reason: string;
  message?: string;
  operation?: ScopeOnboardingOperation;
}): UiActionExecutionResult {
  const failure = scopeFailure(result);
  if (!result.operation) return failure;
  return {
    ...failure,
    message: `${failure.message} ${describeOnboardingOperation(result.operation).join(" ")}`,
  };
}

export async function executeScopesUiAction(
  scopes: KotaClient["scopes"],
  method: string,
  parameters: UiJsonValue | undefined,
): Promise<UiActionExecutionResult | null> {
  if (method === "list") {
    const result = await scopes.list();
    return result.ok
      ? { ok: true, message: `${result.scopes.length} scope(s) available.` }
      : scopeFailure(result);
  }
  if (method === "use") {
    const scopeId = stringParameter(parameters, "scopeId");
    const result = await scopes.use(booleanParameter(parameters, "clear") ? null : scopeId ?? null);
    return result.ok
      ? {
          ok: true,
          message: result.activeScopeId === null
            ? "Active scope cleared."
            : `Active scope set to ${result.activeScopeId}.`,
        }
      : scopeFailure(result);
  }
  if (method === "inspectOnboarding") {
    const directoryRoot = stringParameter(parameters, "directoryRoot");
    if (!directoryRoot) return { ok: false, reason: "invalid-input", message: "directoryRoot is required." };
    const result = await scopes.inspectOnboarding(directoryRoot);
    if (!result.ok) return scopeFailure(result);
    const inspection = result.inspection;
    return { ok: true, message: describeOnboardingInspection(inspection).join(" ") };
  }
  if (method === "planOnboarding" || method === "addOnboarding") {
    const request = onboardingRequest(parameters);
    if (!request.ok) return request.result;
    const planned = await scopes.planOnboarding(request.directoryRoot, request.choices);
    if (!planned.ok) return scopeFailure(planned);
    const plan = planned.plan;
    if (method === "planOnboarding") {
      return { ok: true, message: describeOnboardingPlan(plan).join(" ") };
    }
    if (plan.blockers.length > 0) {
      return {
        ok: false,
        reason: "blocked",
        message: describeOnboardingPlan(plan).join(" "),
      };
    }
    const dangerous = plan.choices.trust ||
      plan.choices.improvementPosture !== "observe" ||
      plan.choices.writes.mode !== "none";
    const applied = await scopes.applyOnboarding(
      plan,
      dangerous ? "confirm-dangerous" : "apply",
    );
    if (!applied.ok) return onboardingFailure(applied);
    const operation = applied.operation;
    return { ok: true, message: describeOnboardingOperation(operation).join(" ") };
  }
  if (method === "getOnboardingStatus") {
    const operationId = stringParameter(parameters, "operationId");
    if (!operationId) return { ok: false, reason: "invalid-input", message: "operationId is required." };
    const result = await scopes.getOnboardingStatus(operationId);
    if (!result.ok) return scopeFailure(result);
    const operation = result.operation;
    return { ok: true, message: describeOnboardingOperation(operation).join(" ") };
  }
  if (method === "retryOnboarding") {
    const operationId = stringParameter(parameters, "operationId");
    if (!operationId) return { ok: false, reason: "invalid-input", message: "operationId is required." };
    const status = await scopes.getOnboardingStatus(operationId);
    if (!status.ok) return scopeFailure(status);
    const plan = status.operation.acceptedPlan;
    const dangerous = plan.choices.trust ||
      plan.choices.improvementPosture !== "observe" ||
      plan.choices.writes.mode !== "none";
    const result = await scopes.retryOnboarding(
      operationId,
      plan.scopeId,
      dangerous ? "confirm-dangerous" : "apply",
    );
    return result.ok
      ? { ok: true, message: describeOnboardingOperation(result.operation).join(" ") }
      : onboardingFailure(result);
  }
  if (method === "cancelOnboarding") {
    const operationId = stringParameter(parameters, "operationId");
    if (!operationId) return { ok: false, reason: "invalid-input", message: "operationId is required." };
    const result = await scopes.cancelOnboarding(operationId);
    return result.ok
      ? { ok: true, message: `Operation ${operationId} cancelled and rolled back.` }
      : onboardingFailure(result);
  }
  if (method === "drain") {
    const scopeId = stringParameter(parameters, "scopeId");
    if (!scopeId) return { ok: false, reason: "invalid-input", message: "scopeId is required." };
    const result = await scopes.drain(scopeId);
    return result.ok
      ? { ok: true, message: `Scope ${scopeId} is drained and no longer accepts work.` }
      : scopeFailure(result);
  }
  if (method === "remove") {
    const scopeId = stringParameter(parameters, "scopeId");
    if (!scopeId) return { ok: false, reason: "invalid-input", message: "scopeId is required." };
    const result = await scopes.remove(scopeId);
    return result.ok
      ? { ok: true, message: `Scope ${scopeId} is no longer hosted. Its folder was not deleted.` }
      : scopeFailure(result);
  }
  return null;
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
    const message = result.reason === "daemon_required"
      ? `The daemon must be running to queue ${run.workflow}.`
      : result.reason === "workflow_contract_conflict"
        ? `Workflow ${run.workflow} no longer accepts the retained run's trigger contract.`
        : `Workflow ${run.workflow} is already queued.`;
    return {
      ok: false,
      reason: result.reason,
      message,
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
  if (action.operation.namespace === "scopes") {
    const result = await executeScopesUiAction(
      client.scopes,
      action.operation.method,
      parameters,
    );
    if (result) return result;
  }
  if (action.operation.namespace === "daemonOps" && action.operation.method === "status") {
    const status = await client.daemonOps.status();
    if (status.state === "running") {
      return { ok: true, message: `Daemon running pid ${status.status.pid}.` };
    }
    return { ok: true, message: `Daemon ${status.state.replace(/_/g, " ")}.` };
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
