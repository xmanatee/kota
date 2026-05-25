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

import { deriveProjectId } from "#core/daemon/project-registry.js";
import type { ModuleContext, ModuleRouteHandler, RouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import {
  type InboundSignalInputObject,
  inboundSignalReceived,
  normalizeInboundSignalInput,
} from "#modules/inbound-signals/events.js";

function makeEventTriggerHandler(ctx: ModuleContext): ModuleRouteHandler {
  return async (req, res, params) => {
    const rawName = params.name;
    if (!rawName || /%(?![0-9A-Fa-f]{2})/.test(rawName)) {
      // The matcher preserves the raw segment when decodeURIComponent fails;
      // reject malformed percent-encoding here with a domain-specific 400.
      jsonResponse(res, 400, { error: "Invalid event name encoding" });
      return;
    }
    const eventName = rawName;

    if (eventName.length > 256) {
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

    if (eventName === inboundSignalReceived.name) {
      const receivedAt = new Date().toISOString();
      const normalized = normalizeInboundSignalInput(
        payload as InboundSignalInputObject,
        { projectId: deriveProjectId(ctx.cwd), receivedAt },
      );
      if (!normalized.ok) {
        jsonResponse(res, 400, { error: normalized.error });
        return;
      }

      ctx.events.emit(inboundSignalReceived, normalized.payload);
      jsonResponse(res, 200, {
        ok: true,
        event: inboundSignalReceived.name,
        projectId: normalized.payload.projectId,
        actorTrust: normalized.payload.actor.trust,
        listeners:
          ctx.events.listenerCount(inboundSignalReceived.name) +
          ctx.events.listenerCount("*"),
      });
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
      path: "/api/events/:name",
      handler: makeEventTriggerHandler(ctx),
    },
  ];
}
