import type { IncomingMessage, ServerResponse } from "node:http";
import { getSecretStore, initSecretStore, type SecretScope } from "#core/config/secrets.js";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";

const SECRET_BY_NAME_PATTERN = /^\/api\/secrets\/([^/?]+)/;

function ensureStore(): ReturnType<typeof getSecretStore> {
  return getSecretStore() ?? initSecretStore();
}

function parseScope(value: unknown): SecretScope | null {
  if (value === "project" || value === "global") return value;
  return null;
}

export function handleListSecrets(res: ServerResponse): void {
  try {
    const store = ensureStore();
    if (!store) {
      jsonResponse(res, 200, { secrets: [] });
      return;
    }
    jsonResponse(res, 200, { secrets: store.list() });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function handleGetSecret(res: ServerResponse, name: string): void {
  try {
    const store = ensureStore();
    if (!store) {
      jsonResponse(res, 404, { found: false });
      return;
    }
    const value = store.get(name);
    if (value === null) {
      jsonResponse(res, 404, { found: false });
      return;
    }
    jsonResponse(res, 200, { found: true, value });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export async function handleSetSecret(
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
): Promise<void> {
  try {
    const body = await readBody(req);
    const value = body.value;
    if (typeof value !== "string" || value.length === 0) {
      jsonResponse(res, 400, { error: "Body must include a non-empty string `value`." });
      return;
    }
    const scope = parseScope(body.scope);
    if (!scope) {
      jsonResponse(res, 400, { error: "Body must include `scope` as 'project' or 'global'." });
      return;
    }
    const store = ensureStore();
    if (!store) {
      jsonResponse(res, 500, { error: "Secret store unavailable." });
      return;
    }
    store.set(name, value, scope);
    jsonResponse(res, 200, { ok: true });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function handleRemoveSecret(
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
): void {
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    const scope = parseScope(url.searchParams.get("scope"));
    if (!scope) {
      jsonResponse(res, 400, { error: "Query parameter `scope` must be 'project' or 'global'." });
      return;
    }
    const store = ensureStore();
    if (!store) {
      jsonResponse(res, 404, { error: "Secret store unavailable." });
      return;
    }
    if (!store.remove(name, scope)) {
      jsonResponse(res, 404, { error: `Secret "${name}" not found in ${scope} scope.` });
      return;
    }
    jsonResponse(res, 200, { ok: true });
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function secretsRoutes(): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/secrets",
      handler: (_req, res) => handleListSecrets(res),
    },
    {
      method: "GET",
      path: "/api/secrets/",
      pathPattern: SECRET_BY_NAME_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url ?? "", "http://localhost").pathname.match(SECRET_BY_NAME_PATTERN);
        if (!match) {
          jsonResponse(res, 400, { error: "Missing secret name." });
          return;
        }
        handleGetSecret(res, decodeURIComponent(match[1]));
      },
    },
    {
      method: "PUT",
      path: "/api/secrets/",
      pathPattern: SECRET_BY_NAME_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url ?? "", "http://localhost").pathname.match(SECRET_BY_NAME_PATTERN);
        if (!match) {
          jsonResponse(res, 400, { error: "Missing secret name." });
          return;
        }
        return handleSetSecret(req, res, decodeURIComponent(match[1]));
      },
    },
    {
      method: "DELETE",
      path: "/api/secrets/",
      pathPattern: SECRET_BY_NAME_PATTERN,
      handler: (req, res) => {
        const match = new URL(req.url ?? "", "http://localhost").pathname.match(SECRET_BY_NAME_PATTERN);
        if (!match) {
          jsonResponse(res, 400, { error: "Missing secret name." });
          return;
        }
        handleRemoveSecret(req, res, decodeURIComponent(match[1]));
      },
    },
  ];
}
