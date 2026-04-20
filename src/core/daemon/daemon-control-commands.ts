import type { IncomingMessage, ServerResponse } from "node:http";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type { SlashCommandCatalog } from "#core/modules/slash-command-provider.js";
import { SLASH_COMMAND_PROVIDER_TYPE } from "#core/modules/slash-command-provider.js";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { jsonResponse, readBody } from "./daemon-control-utils.js";

function getCatalog(): SlashCommandCatalog | null {
  const registry = getProviderRegistry();
  if (!registry) return null;
  return registry.get<SlashCommandCatalog>(SLASH_COMMAND_PROVIDER_TYPE);
}

export function handleListCommands(res: ServerResponse): void {
  const catalog = getCatalog();
  if (!catalog) {
    jsonResponse(res, 503, { error: "Slash-command catalog unavailable" });
    return;
  }
  jsonResponse(res, 200, { commands: catalog.list() });
}

export function handleInvokeCommand(
  handle: DaemonControlHandle,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  readBody(req)
    .then((buf) => {
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
      const result = handle.enqueuePendingRun(action.workflow);
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
    })
    .catch(() => jsonResponse(res, 500, { error: "Internal error" }));
}
