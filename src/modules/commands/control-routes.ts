/**
 * Daemon-control route contribution for the commands module.
 *
 * Exposes `GET /commands` (`read`) and `POST /commands/invoke` (`control`).
 * Both handlers query the same `SlashCommandCatalog` the module shares with
 * its `/api/commands*` web routes via the provider registry, and use the
 * workflow-dispatcher seam (`#core/workflow/workflow-dispatcher-provider`)
 * to enqueue pending runs without holding a `DaemonControlHandle`.
 *
 * The wire contract matches the legacy core handler verbatim — same status
 * codes (200 / 400 / 404 / 409 / 503) and response envelopes — so existing
 * `DaemonControlClient` and CLI consumers keep working unchanged.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
  SLASH_COMMAND_PROVIDER_TYPE,
  type SlashCommandCatalog,
} from "#core/modules/slash-command-provider.js";
import { getWorkflowDispatcher } from "#core/workflow/workflow-dispatcher-provider.js";

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function getCatalog(): SlashCommandCatalog | null {
  const registry = getProviderRegistry();
  if (!registry) return null;
  return registry.get<SlashCommandCatalog>(SLASH_COMMAND_PROVIDER_TYPE);
}

export function handleListCommandsControl(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  const catalog = getCatalog();
  if (!catalog) {
    jsonResponse(res, 503, { error: "Slash-command catalog unavailable" });
    return;
  }
  jsonResponse(res, 200, { commands: catalog.list() });
}

export async function handleInvokeCommandControl(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let buf: Buffer;
  try {
    buf = await readBody(req);
  } catch {
    jsonResponse(res, 500, { error: "Internal error" });
    return;
  }
  const catalog = getCatalog();
  if (!catalog) {
    jsonResponse(res, 503, { error: "Slash-command catalog unavailable" });
    return;
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(buf.toString()) as Record<string, unknown>;
  } catch {
    jsonResponse(res, 400, { error: "Invalid JSON body" });
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
  const dispatcher = getWorkflowDispatcher();
  if (!dispatcher) {
    jsonResponse(res, 503, { error: "Workflow dispatcher unavailable" });
    return;
  }
  const result = dispatcher.enqueuePendingRun(action.workflow);
  if (result.alreadyQueued) {
    jsonResponse(res, 409, {
      error: `Workflow "${action.workflow}" is already queued`,
    });
    return;
  }
  if (!result.ok) {
    jsonResponse(res, 400, {
      error: result.error ?? "Failed to enqueue workflow",
    });
    return;
  }
  jsonResponse(res, 200, {
    kind: "workflow",
    queued: result.queued ?? action.workflow,
    runId: result.runId,
  });
}

export function commandsControlRoutes(): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/commands",
      capabilityScope: "read",
      handler: handleListCommandsControl,
    },
    {
      method: "POST",
      path: "/commands/invoke",
      capabilityScope: "control",
      handler: handleInvokeCommandControl,
    },
  ];
}
