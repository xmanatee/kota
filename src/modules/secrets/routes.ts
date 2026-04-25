import type { ServerResponse } from "node:http";
import { getSecretStore, initSecretStore } from "#core/config/secrets.js";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";

function ensureStore(): ReturnType<typeof getSecretStore> {
  return getSecretStore() ?? initSecretStore();
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

export function secretsRoutes(): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/secrets",
      handler: (_req, res) => handleListSecrets(res),
    },
  ];
}
