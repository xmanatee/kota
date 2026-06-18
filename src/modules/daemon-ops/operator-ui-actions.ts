import type { KotaClient } from "#core/server/kota-client.js";
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
  if (action.operation.namespace === "projects" && action.operation.method === "list") {
    const result = await client.projects.list();
    if (!result.ok) return { ok: false, reason: result.reason, message: "Daemon project registry is unavailable." };
    return { ok: true, message: `${result.projects.length} project(s) available.` };
  }
  if (action.operation.namespace === "workflow" && action.operation.method === "listDefinitions") {
    const result = await client.workflow.listDefinitions();
    return { ok: true, message: `${result.definitions.length} workflow definition(s) available.` };
  }
  if (action.operation.namespace === "sessions" && action.operation.method === "list") {
    const result = await client.sessions.list();
    return { ok: true, message: `${result.sessions.length} session(s) available.` };
  }
  if (action.operation.namespace === "doctor" && action.operation.method === "fix") {
    const result = await client.doctor.fix();
    return { ok: true, message: `${result.repairs.length} doctor repair(s) processed.` };
  }
  return {
    ok: false,
    reason: "unsupported-operation",
    message: `${action.operation.namespace}.${action.operation.method} is not implemented by the CLI UI action executor.`,
  };
}
