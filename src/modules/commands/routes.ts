import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteRegistration } from "#core/modules/module-types.js";
import {
  type DaemonTransport,
  getDaemonTransport,
} from "#core/server/daemon-transport.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { SlashCommandCatalog } from "./catalog.js";

type InvokeResult =
  | { kind: "workflow"; queued: string; runId?: string }
  | { kind: "skill"; prompt: string };

async function invokeWorkflow(
  workflow: string,
  link: DaemonTransport | null,
): Promise<{ status: number; body: InvokeResult | { error: string } }> {
  if (!link) {
    return { status: 503, body: { error: "Daemon not reachable" } };
  }
  let resp: Response;
  try {
    resp = await link.fetchRaw("/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: workflow }),
    });
  } catch {
    return { status: 503, body: { error: "Daemon not reachable" } };
  }
  if (resp.status === 409) {
    return { status: 409, body: { error: `Workflow "${workflow}" is already queued` } };
  }
  if (!resp.ok) {
    return { status: 503, body: { error: "Daemon not reachable" } };
  }
  const body = (await resp.json()) as { queued?: string; runId?: string };
  return {
    status: 200,
    body: {
      kind: "workflow",
      queued: body.queued ?? workflow,
      ...(body.runId !== undefined && { runId: body.runId }),
    },
  };
}

async function handleInvoke(
  req: IncomingMessage,
  res: ServerResponse,
  catalog: SlashCommandCatalog,
  link: DaemonTransport | null,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readBody(req);
  } catch (err) {
    jsonResponse(res, 400, { error: (err as Error).message });
    return;
  }
  const name = body.name;
  if (typeof name !== "string" || name.length === 0) {
    jsonResponse(res, 400, { error: "name must be a non-empty string" });
    return;
  }
  const action = catalog.resolve(name);
  if (!action) {
    jsonResponse(res, 404, { error: `Command "${name}" not found` });
    return;
  }
  if (action.kind === "skill") {
    jsonResponse(res, 200, { kind: "skill", prompt: action.prompt });
    return;
  }
  const result = await invokeWorkflow(action.workflow, link);
  jsonResponse(res, result.status, result.body);
}

export function commandRoutes(catalog: SlashCommandCatalog): RouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/api/commands",
      handler: (_req, res) => {
        jsonResponse(res, 200, { commands: catalog.list() });
      },
    },
    {
      method: "POST",
      path: "/api/commands/invoke",
      handler: (req, res) =>
        handleInvoke(req, res, catalog, getDaemonTransport()),
    },
  ];
}
