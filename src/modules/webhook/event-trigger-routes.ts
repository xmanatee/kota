/**
 * Generic inbound HTTP → bus event-trigger route contributed by the
 * webhook module.
 *
 * `POST /api/events/:name` lets external systems (CI, ad-hoc curl,
 * non-GitHub webhooks) fire a typed bus event by name with a JSON
 * payload. The route is bearer-token-protected by the server's standard
 * `/api/*` auth (no `bypassAuth` here — unlike `github-webhook`'s
 * signature-validated `/api/webhooks/github`).
 *
 * The handler reaches the bus through the standard module context
 * (`ctx.events.emit`) rather than importing the core event bus
 * directly.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ModuleContext, RouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";

const EVENT_PATH_PATTERN = /^\/api\/events\/([^/]+)$/;

function makeEventTriggerHandler(
  ctx: ModuleContext,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const match = url.pathname.match(EVENT_PATH_PATTERN);
    if (!match) {
      jsonResponse(res, 404, { error: "Not found" });
      return;
    }

    let eventName: string;
    try {
      eventName = decodeURIComponent(match[1]);
    } catch {
      jsonResponse(res, 400, { error: "Invalid event name encoding" });
      return;
    }

    if (!eventName || eventName.length > 256) {
      jsonResponse(res, 400, { error: "Event name must be 1-256 characters" });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await readBody(req);
    } catch (err) {
      jsonResponse(res, 400, { error: (err as Error).message });
      return;
    }

    ctx.events.emitExternal(eventName, payload);
    jsonResponse(res, 200, {
      ok: true,
      event: eventName,
      listeners: ctx.events.listenerCount(eventName) + ctx.events.listenerCount("*"),
    });
  };
}

export function eventTriggerRoutes(ctx: ModuleContext): RouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/api/events/",
      pathPattern: EVENT_PATH_PATTERN,
      handler: makeEventTriggerHandler(ctx),
    },
  ];
}
