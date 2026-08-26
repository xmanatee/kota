import type { KotaClient } from "#root/client/kota-client.generated.js";
import type { UiActionExecutionResult } from "./operator-ui-actions.js";
import type { UiActionOperation, UiJsonValue } from "./operator-ui-types.js";

export type ClientNamespaceOperation = Extract<
  UiActionOperation,
  { kind: "client-namespace" }
>;

export type CapabilityActionArgs = {
  client: KotaClient;
  operation: ClientNamespaceOperation;
  parameters?: UiJsonValue;
};

function parametersObject(
  parameters: UiJsonValue | undefined,
): { readonly [key: string]: UiJsonValue } | null {
  return parameters !== undefined
    && parameters !== null
    && !Array.isArray(parameters)
    && typeof parameters === "object"
    ? parameters
    : null;
}

export function stringParameter(
  parameters: UiJsonValue | undefined,
  key: string,
): string | undefined {
  const value = parametersObject(parameters)?.[key];
  return typeof value === "string" ? value : undefined;
}

export function numberParameter(
  parameters: UiJsonValue | undefined,
  key: string,
): number | undefined {
  const value = parametersObject(parameters)?.[key];
  return typeof value === "number" ? value : undefined;
}

export function booleanParameter(
  parameters: UiJsonValue | undefined,
  key: string,
): boolean | undefined {
  const value = parametersObject(parameters)?.[key];
  return typeof value === "boolean" ? value : undefined;
}

export function missingParameter(key: string): UiActionExecutionResult {
  return { ok: false, reason: "invalid-input", message: `${key} is required.` };
}
