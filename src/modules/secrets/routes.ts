import type { IncomingMessage, ServerResponse } from "node:http";
import type { SecretScope, SecretStore } from "#core/config/secrets.js";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { readScopeSelectorQueryOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { SecretScopeStores } from "./scope.js";

function parseScope(value: unknown): SecretScope | null {
  return value === "scope" || value === "global" ? value : null;
}

function resolveRouteStore(
  req: IncomingMessage,
  res: ServerResponse,
  scopeStores: SecretScopeStores,
): SecretStore | null {
  const selector = readScopeSelectorQueryOrErrorResponse(req, res);
  if (selector === null) return null;
  const resolved = scopeStores.resolve(selector);
  if (!resolved.ok) {
    jsonResponse(res, 404, resolved.error);
    return null;
  }
  return resolved.value.store;
}

export function handleListSecrets(
  req: IncomingMessage,
  res: ServerResponse,
  scopeStores: SecretScopeStores,
): void {
  const store = resolveRouteStore(req, res, scopeStores);
  if (!store) return;
  jsonResponse(res, 200, { secrets: store.list() });
}

export function handleGetSecret(
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
  scopeStores: SecretScopeStores,
): void {
  const store = resolveRouteStore(req, res, scopeStores);
  if (!store) return;
  const value = store.get(name);
  jsonResponse(
    res,
    200,
    value === null ? { found: false } : { found: true, value },
  );
}

export async function handleSetSecret(
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
  scopeStores: SecretScopeStores,
): Promise<void> {
  const store = resolveRouteStore(req, res, scopeStores);
  if (!store) return;
  const body = await readBody(req);
  const value = body.value;
  if (typeof value !== "string" || value.length === 0) {
    jsonResponse(res, 400, { error: "Body must include a non-empty string `value`." });
    return;
  }
  const scope = parseScope(body.scope);
  if (!scope) {
    jsonResponse(res, 400, { error: "Body must include `scope` as 'scope' or 'global'." });
    return;
  }
  store.set(name, value, scope);
  jsonResponse(res, 200, { ok: true });
}

export function handleRemoveSecret(
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
  scopeStores: SecretScopeStores,
): void {
  const store = resolveRouteStore(req, res, scopeStores);
  if (!store) return;
  const scope = parseScope(
    new URL(req.url ?? "", "http://localhost").searchParams.get("scope"),
  );
  if (!scope) {
    jsonResponse(res, 400, { error: "Query parameter `scope` must be 'scope' or 'global'." });
    return;
  }
  jsonResponse(
    res,
    200,
    store.remove(name, scope)
      ? { ok: true }
      : { ok: false, reason: "not_found" },
  );
}

export function secretsRoutes(
  scopeStores: SecretScopeStores,
): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/secrets",
      handler: (req, res) => handleListSecrets(req, res, scopeStores),
    },
    {
      method: "GET",
      path: "/api/secrets/:name",
      handler: (req, res, params) =>
        handleGetSecret(req, res, params.name, scopeStores),
    },
    {
      method: "PUT",
      path: "/api/secrets/:name",
      handler: (req, res, params) =>
        handleSetSecret(req, res, params.name, scopeStores),
    },
    {
      method: "DELETE",
      path: "/api/secrets/:name",
      handler: (req, res, params) =>
        handleRemoveSecret(req, res, params.name, scopeStores),
    },
  ];
}
