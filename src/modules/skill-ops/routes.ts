/**
 * Daemon-control HTTP routes for the `skills` namespace.
 *
 * Both the daemon-control server and the local-side handler reach the
 * same `listSkills` / `importSkill` helpers so daemon-up and daemon-down
 * callers see the same skill shape. Routes live on the daemon-control
 * surface under bearer auth.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  ModuleContext,
} from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import { importSkill, listSkills } from "./skill-ops-operations.js";

function handleList(ctx: ModuleContext, _req: IncomingMessage, res: ServerResponse): void {
  jsonResponse(res, 200, listSkills(ctx));
}

async function handleImport(
  ctx: ModuleContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return;
  }
  const source = typeof body.source === "string" ? body.source : null;
  if (!source) {
    jsonResponse(res, 400, { error: "source is required" });
    return;
  }
  const name = typeof body.name === "string" ? body.name : undefined;
  const skill = typeof body.skill === "string" ? body.skill : undefined;
  const all = typeof body.all === "boolean" ? body.all : undefined;
  const options = {
    ...(name !== undefined && { name }),
    ...(skill !== undefined && { skill }),
    ...(all !== undefined && { all }),
  };
  const result = await importSkill(
    ctx,
    source,
    Object.keys(options).length > 0 ? options : undefined,
  );
  jsonResponse(res, 200, result);
}

export function skillControlRoutes(ctx: ModuleContext): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/skills",
      capabilityScope: "read",
      handler: (req, res) => handleList(ctx, req, res),
    },
    {
      method: "POST",
      path: "/skills/import",
      capabilityScope: "control",
      handler: (req, res) => handleImport(ctx, req, res),
    },
  ];
}
