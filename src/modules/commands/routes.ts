import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import type { SlashCommandCatalog } from "./catalog.js";

type InvokeResult =
  | { kind: "workflow"; queued: string; runId?: string }
  | { kind: "skill"; prompt: string };

async function invokeWorkflow(
  workflow: string,
  client: DaemonControlClient | null,
): Promise<{ status: number; body: InvokeResult | { error: string } }> {
  if (!client) {
    return { status: 503, body: { error: "Daemon not reachable" } };
  }
  const result = await client.trigger(workflow);
  if (!result) {
    return { status: 503, body: { error: "Daemon not reachable" } };
  }
  if (result.alreadyQueued) {
    return { status: 409, body: { error: `Workflow "${workflow}" is already queued` } };
  }
  return {
    status: 200,
    body: { kind: "workflow", queued: result.queued ?? workflow, runId: result.runId },
  };
}

async function handleInvoke(
  req: IncomingMessage,
  res: ServerResponse,
  catalog: SlashCommandCatalog,
  client: DaemonControlClient | null,
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
  const result = await invokeWorkflow(action.workflow, client);
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
        handleInvoke(req, res, catalog, DaemonControlClient.fromStateDir()),
    },
  ];
}
