import type { KotaClient } from "#core/server/kota-client.js";
import { appendScopeSelector, encodeQueryParams } from "#core/server/scope-selector.js";
import type { UiActionExecutionResult, UiJsonValue } from "./operator-ui.js";
import type { UiActionOperation } from "./operator-ui-types.js";

function uiObjectParameter(
  parameters: UiJsonValue | undefined,
): { readonly [key: string]: UiJsonValue } | null {
  if (
    parameters === undefined ||
    parameters === null ||
    Array.isArray(parameters) ||
    typeof parameters !== "object"
  ) return null;
  return parameters;
}

export function stringUiParameter(
  parameters: UiJsonValue | undefined,
  key: string,
): string | undefined {
  const value = uiObjectParameter(parameters)?.[key];
  return typeof value === "string" ? value : undefined;
}

export function booleanUiParameter(parameters: UiJsonValue | undefined, key: string): boolean {
  return uiObjectParameter(parameters)?.[key] === true;
}

type SetupRequirementRoute = {
  moduleName: string;
  requirementId: string;
  action?: "form" | "secret" | "start" | "refresh";
};

function parseSetupCompleteRoute(path: string): string | null {
  const match = /^\/setup\/actions\/([^/]+)\/complete$/.exec(path);
  return match ? decodeURIComponent(match[1]!) : null;
}

function parseSetupRequirementRoute(path: string): SetupRequirementRoute | null {
  const match = /^\/setup\/requirements\/([^/]+)\/([^/]+)(?:\/(form|secret|start|refresh))?$/.exec(path);
  if (!match) return null;
  return {
    moduleName: decodeURIComponent(match[1]!),
    requirementId: decodeURIComponent(match[2]!),
    action: match[3] as SetupRequirementRoute["action"],
  };
}

function setupFormValuesFromUi(parameters: UiJsonValue | undefined) {
  const obj = uiObjectParameter(parameters);
  if (!obj) return { ok: false as const, message: "Setup form parameters must be a JSON object." };
  const values: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return { ok: false as const, message: `Setup form field "${key}" must be string, number, or boolean.` };
    }
    values[key] = value;
  }
  return { ok: true as const, value: values };
}

function setupSecretValuesFromUi(parameters: UiJsonValue | undefined) {
  const obj = uiObjectParameter(parameters);
  if (!obj) return { ok: false as const, message: "Setup secret parameters must be a JSON object." };
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== "string" || value.length === 0) {
      return { ok: false as const, message: `Setup secret field "${key}" must be a non-empty string.` };
    }
    values[key] = value;
  }
  return { ok: true as const, value: values };
}

function setupMutationResult(
  result: Awaited<ReturnType<KotaClient["setup"]["submitForm"]>>,
  successMessage: string,
): UiActionExecutionResult {
  return result.ok
    ? { ok: true, message: successMessage }
    : { ok: false, reason: result.reason, message: result.message };
}

export async function executeLocalSetupRoute(
  client: KotaClient,
  operation: Extract<UiActionOperation, { kind: "daemon-route" }>,
  parameters: UiJsonValue | undefined,
): Promise<UiActionExecutionResult | null> {
  const completeActionId = parseSetupCompleteRoute(operation.path);
  if (operation.method === "POST" && completeActionId !== null) {
    const values = parameters === undefined
      ? { ok: true as const, value: {} }
      : setupSecretValuesFromUi(parameters);
    if (!values.ok) return { ok: false, reason: "invalid-input", message: values.message };
    return setupMutationResult(
      await client.setup.complete(
        completeActionId,
        Object.keys(values.value).length > 0 ? { secretValues: values.value } : {},
      ),
      "Setup action completed.",
    );
  }
  const route = parseSetupRequirementRoute(operation.path);
  if (!route) return null;
  if (operation.method === "POST" && route.action === "form") {
    const values = setupFormValuesFromUi(parameters);
    if (!values.ok) return { ok: false, reason: "invalid-input", message: values.message };
    return setupMutationResult(
      await client.setup.submitForm(route.moduleName, route.requirementId, values.value),
      "Setup form submitted.",
    );
  }
  if (operation.method === "POST" && route.action === "secret") {
    const values = setupSecretValuesFromUi(parameters);
    if (!values.ok) return { ok: false, reason: "invalid-input", message: values.message };
    return setupMutationResult(
      await client.setup.storeSecret(route.moduleName, route.requirementId, values.value),
      "Setup secrets stored.",
    );
  }
  if (operation.method === "POST" && route.action === "start") {
    const result = await client.setup.start(route.moduleName, route.requirementId);
    return result.ok
      ? { ok: true, message: "Setup action started." }
      : { ok: false, reason: result.reason, message: result.message };
  }
  if (operation.method === "POST" && route.action === "refresh") {
    return setupMutationResult(
      await client.setup.refresh(route.moduleName, route.requirementId),
      "Setup status refreshed.",
    );
  }
  if (operation.method === "DELETE" && route.action === undefined) {
    return setupMutationResult(
      await client.setup.revoke(route.moduleName, route.requirementId),
      "Setup revoked.",
    );
  }
  return {
    ok: false,
    reason: "invalid-input",
    message: `${operation.method} ${operation.path} is not a setup UI action route.`,
  };
}

export function setupRouteBody(
  operation: Extract<UiActionOperation, { kind: "daemon-route" }>,
  parameters: UiJsonValue | undefined,
): UiJsonValue | undefined {
  if (operation.method === "POST" && parseSetupCompleteRoute(operation.path) !== null) {
    const secretValues = uiObjectParameter(parameters);
    return secretValues === null ? {} : { secretValues };
  }
  const route = parseSetupRequirementRoute(operation.path);
  if (!route) return parameters;
  if (operation.method === "POST" && route.action === "form") {
    return { values: uiObjectParameter(parameters) ?? {} };
  }
  if (operation.method === "POST" && route.action === "secret") {
    return { secretValues: uiObjectParameter(parameters) ?? {} };
  }
  return undefined;
}

export function scopedUiActionClient(client: KotaClient, scopeId: string): KotaClient {
  return client.forScope(scopeId);
}

export function scopedUiActionPath(path: string, scopeId: string): string {
  const url = new URL(path, "http://localhost");
  appendScopeSelector(url.searchParams, { scopeId });
  const query = encodeQueryParams(url.searchParams);
  return `${url.pathname}${query ? `?${query}` : ""}`;
}
