/**
 * Daemon-control HTTP routes for the `audit` namespace.
 *
 * The route reaches the same `listAuditEntries` helper the local-side
 * handler uses so daemon-up and daemon-down callers return the same
 * payload shape for the same filter.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  ModuleContext,
} from "#core/modules/module-types.js";
import type { AuditListFilter } from "#core/server/kota-client.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { listAuditEntries } from "./audit-operations.js";

function parseFilter(url: URL): AuditListFilter {
  const filter: AuditListFilter = {};
  const limit = url.searchParams.get("limit");
  if (limit) {
    const parsed = Number.parseInt(limit, 10);
    if (Number.isFinite(parsed) && parsed > 0) filter.limit = parsed;
  }
  const tool = url.searchParams.get("tool");
  if (tool) filter.tool = tool;
  const risk = url.searchParams.get("risk");
  if (risk) filter.risk = risk as AuditListFilter["risk"];
  const policy = url.searchParams.get("policy");
  if (policy) filter.policy = policy as AuditListFilter["policy"];
  const since = url.searchParams.get("since");
  if (since) filter.since = since;
  const session = url.searchParams.get("session");
  if (session) filter.session = session;
  return filter;
}

function handleList(ctx: ModuleContext, req: IncomingMessage, res: ServerResponse): void {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const result = listAuditEntries(ctx, parseFilter(url));
    jsonResponse(res, 200, result);
  } catch (err) {
    jsonResponse(res, 500, { error: (err as Error).message });
  }
}

export function auditControlRoutes(ctx: ModuleContext): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/audit",
      capabilityScope: "read",
      handler: (req, res) => handleList(ctx, req, res),
    },
  ];
}
