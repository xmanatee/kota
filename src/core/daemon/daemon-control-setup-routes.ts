import type { ServerResponse } from "node:http";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import type {
  ModuleSetupCompleteInput,
  ModuleSetupFailureResult,
  ModuleSetupFormValue,
  ModuleSetupFormValues,
  ModuleSetupJsonValue,
  ModuleSetupMutationResult,
  ModuleSetupStartResult,
} from "#core/modules/setup-requirements.js";
import type { BuiltinControlRouteDeps } from "./daemon-control-routes.js";
import { jsonResponse, readBody } from "./daemon-control-utils.js";

type SetupJsonObject = { [key: string]: ModuleSetupJsonValue };
type ParsedSetupBody<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

function setupErrorStatus(result: ModuleSetupFailureResult): 400 | 404 | 500 {
  if (result.reason === "not_found") return 404;
  if (result.reason === "store_error") return 500;
  return 400;
}

function respondSetupMutation(
  res: ServerResponse,
  result: ModuleSetupMutationResult | ModuleSetupStartResult,
): void {
  if (result.ok) {
    jsonResponse(res, 200, result);
    return;
  }
  jsonResponse(res, setupErrorStatus(result), result);
}

function asSetupObject(value: ModuleSetupJsonValue): SetupJsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value;
}

function parseSetupJson(raw: Buffer): ParsedSetupBody<SetupJsonObject> {
  try {
    const text = raw.toString("utf8");
    const parsed = JSON.parse(text || "{}") as ModuleSetupJsonValue;
    const object = asSetupObject(parsed);
    if (!object) return { ok: false, message: "Body must be a JSON object" };
    return { ok: true, value: object };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function parseFormValues(raw: Buffer): ParsedSetupBody<ModuleSetupFormValues> {
  const parsed = parseSetupJson(raw);
  if (!parsed.ok) return parsed;
  const object = asSetupObject(parsed.value.values ?? null);
  if (!object) return { ok: false, message: "Body must include object `values`" };
  const normalized: ModuleSetupFormValues = {};
  for (const [key, value] of Object.entries(object)) {
    if (
      typeof value !== "string"
      && typeof value !== "number"
      && typeof value !== "boolean"
    ) {
      return { ok: false, message: `Value for "${key}" must be string, number, or boolean` };
    }
    normalized[key] = value;
  }
  return { ok: true, value: normalized };
}

function parseSecretValues(raw: Buffer): ParsedSetupBody<Record<string, string>> {
  const parsed = parseSetupJson(raw);
  if (!parsed.ok) return parsed;
  const values = asSetupObject(parsed.value.secretValues ?? null);
  if (!values) return { ok: false, message: "Body must include object `secretValues`" };
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "string" || value.length === 0) {
      return { ok: false, message: `Secret value for "${key}" must be a non-empty string` };
    }
    normalized[key] = value;
  }
  return { ok: true, value: normalized };
}

function readOptionalFormValues(
  value: ModuleSetupJsonValue | undefined,
): ModuleSetupFormValues | undefined | string {
  if (value === undefined) return undefined;
  const object = asSetupObject(value);
  if (!object) return "`configValues` must be an object";
  const configValues: ModuleSetupFormValues = {};
  for (const [key, entry] of Object.entries(object)) {
    if (
      typeof entry !== "string"
      && typeof entry !== "number"
      && typeof entry !== "boolean"
    ) {
      return `Config value for "${key}" must be string, number, or boolean`;
    }
    configValues[key] = entry as ModuleSetupFormValue;
  }
  return configValues;
}

function readOptionalSecretValues(
  value: ModuleSetupJsonValue | undefined,
): Record<string, string> | undefined | string {
  if (value === undefined) return undefined;
  const object = asSetupObject(value);
  if (!object) return "`secretValues` must be an object";
  const secretValues: Record<string, string> = {};
  for (const [key, entry] of Object.entries(object)) {
    if (typeof entry !== "string" || entry.length === 0) {
      return `Secret value for "${key}" must be a non-empty string`;
    }
    secretValues[key] = entry;
  }
  return secretValues;
}

function parseCompleteInput(raw: Buffer): ParsedSetupBody<ModuleSetupCompleteInput> {
  const parsed = parseSetupJson(raw);
  if (!parsed.ok) return parsed;
  const configValues = readOptionalFormValues(parsed.value.configValues);
  if (typeof configValues === "string") return { ok: false, message: configValues };
  const secretValues = readOptionalSecretValues(parsed.value.secretValues);
  if (typeof secretValues === "string") return { ok: false, message: secretValues };
  return {
    ok: true,
    value: {
      ...(configValues !== undefined && { configValues }),
      ...(secretValues !== undefined && { secretValues }),
    },
  };
}

export function buildDaemonSetupControlRoutes(
  deps: BuiltinControlRouteDeps,
): ControlRouteRegistration[] {
  const h = deps.handle;
  return [
    {
      method: "GET",
      path: "/setup/requirements",
      capabilityScope: "read",
      handler: (_req, res) => h.listModuleSetupStatuses()
        .then((response) => jsonResponse(res, 200, response)),
    },
    {
      method: "POST",
      path: "/setup/requirements/:moduleName/:requirementId/form",
      capabilityScope: "control",
      handler: async (req, res, params) => {
        const body = parseFormValues(await readBody(req));
        if (!body.ok) {
          jsonResponse(res, 400, { ok: false, reason: "invalid_request", message: body.message });
          return;
        }
        respondSetupMutation(
          res,
          await h.submitModuleSetupForm(params.moduleName, params.requirementId, body.value),
        );
      },
    },
    {
      method: "POST",
      path: "/setup/requirements/:moduleName/:requirementId/secret",
      capabilityScope: "control",
      handler: async (req, res, params) => {
        const body = parseSecretValues(await readBody(req));
        if (!body.ok) {
          jsonResponse(res, 400, { ok: false, reason: "invalid_request", message: body.message });
          return;
        }
        respondSetupMutation(
          res,
          await h.storeModuleSetupSecret(params.moduleName, params.requirementId, body.value),
        );
      },
    },
    {
      method: "POST",
      path: "/setup/requirements/:moduleName/:requirementId/start",
      capabilityScope: "control",
      handler: async (_req, res, params) => respondSetupMutation(
        res,
        await h.startModuleSetup(params.moduleName, params.requirementId),
      ),
    },
    {
      method: "POST",
      path: "/setup/actions/:actionId/complete",
      capabilityScope: "control",
      handler: async (req, res, params) => {
        const body = parseCompleteInput(await readBody(req));
        if (!body.ok) {
          jsonResponse(res, 400, { ok: false, reason: "invalid_request", message: body.message });
          return;
        }
        respondSetupMutation(res, await h.completeModuleSetup(params.actionId, body.value));
      },
    },
    {
      method: "POST",
      path: "/setup/requirements/:moduleName/:requirementId/refresh",
      capabilityScope: "control",
      handler: async (_req, res, params) => respondSetupMutation(
        res,
        await h.refreshModuleSetup(params.moduleName, params.requirementId),
      ),
    },
    {
      method: "DELETE",
      path: "/setup/requirements/:moduleName/:requirementId",
      capabilityScope: "control",
      handler: async (_req, res, params) => respondSetupMutation(
        res,
        await h.revokeModuleSetup(params.moduleName, params.requirementId),
      ),
    },
  ];
}
