/**
 * Daemon-control HTTP routes for the `webhook` namespace.
 *
 * Both the daemon-control server and the local-side handler reach the same
 * `listWebhooks` / `generateWebhookSecret` / `removeWebhookSecret` helpers
 * so daemon-up and daemon-down callers see the same shape and the same
 * `.kota/config.json` mutation. Routes live on the daemon-control surface
 * under bearer auth.
 *
 * Path namespacing notes: the inbound signature-validated trigger route
 * lives at `POST /webhooks/:name` with `bypassAuth: true`. These secret
 * routes use distinct paths (`GET /webhooks`,
 * `POST /webhooks/:workflow/secret`, `DELETE /webhooks/:workflow/secret`)
 * and the standard bearer auth, so the two surfaces coexist without
 * conflict.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  ModuleContext,
} from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";
import {
  generateWebhookSecret,
  listWebhooks,
  removeWebhookSecret,
} from "./webhook-operations.js";

function handleList(ctx: ModuleContext, _req: IncomingMessage, res: ServerResponse): void {
  jsonResponse(res, 200, listWebhooks(ctx));
}

function handleGenerate(
  ctx: ModuleContext,
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  const result = generateWebhookSecret(ctx, params.workflow);
  jsonResponse(res, 200, result);
}

function handleRemove(
  ctx: ModuleContext,
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  const result = removeWebhookSecret(ctx, params.workflow);
  jsonResponse(res, 200, result);
}

export function webhookSecretControlRoutes(ctx: ModuleContext): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/webhooks",
      capabilityScope: "read",
      handler: (req, res) => handleList(ctx, req, res),
    },
    {
      method: "POST",
      path: "/webhooks/:workflow/secret",
      capabilityScope: "control",
      handler: (req, res, params) => handleGenerate(ctx, req, res, params),
    },
    {
      method: "DELETE",
      path: "/webhooks/:workflow/secret",
      capabilityScope: "control",
      handler: (req, res, params) => handleRemove(ctx, req, res, params),
    },
  ];
}
