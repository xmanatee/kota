/**
 * Daemon-control HTTP routes for the `agents` namespace.
 *
 * Both the daemon-control server (when `kota daemon` is running) and the
 * local-side handler reach the same `listAgents` / `inspectAgent` helpers
 * so daemon-up and daemon-down callers see the same agent shape. Routes
 * live on the daemon-control surface under bearer auth; no separate
 * `kota serve` route is contributed here — the CLI is the consumer that
 * matters today, and the web UI's agent surface (when added) can extend
 * the contract.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  ModuleContext,
} from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { inspectAgent, listAgents } from "./agent-ops-operations.js";

function handleList(ctx: ModuleContext, _req: IncomingMessage, res: ServerResponse): void {
  jsonResponse(res, 200, listAgents(ctx));
}

function handleInspect(
  ctx: ModuleContext,
  _req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  jsonResponse(res, 200, inspectAgent(ctx, params.name));
}

export function agentControlRoutes(ctx: ModuleContext): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/agents",
      capabilityScope: "read",
      handler: (req, res) => handleList(ctx, req, res),
    },
    {
      method: "GET",
      path: "/agents/:name",
      capabilityScope: "read",
      handler: (req, res, params) => handleInspect(ctx, req, res, params),
    },
  ];
}
