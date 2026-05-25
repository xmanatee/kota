/**
 * Social module — configured inbound adapters for social platform signals.
 *
 * Config (under modules.social):
 *   inbound.connectors: Social webhook connectors that emit inbound signals.
 *
 * Connector secrets may be literal strings, `$ENV_VAR` references, or
 * `secret:name` references resolved through the KOTA secrets provider.
 */

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { deriveProjectId } from "#core/daemon/project-registry.js";
import type {
  KotaModule,
  ModuleContext,
  ModuleRouteHandler,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import {
  type InboundSignalJsonObject,
  inboundSignalReceived,
} from "#modules/inbound-signals/events.js";
import {
  emitSocialInboundSignal,
  type SocialConnectorConfig,
  socialDeliveryFromInboundRequest,
  socialDeliveryToInboundSignal,
} from "./inbound-signal.js";

type SocialInboundConfig = {
  connectors?: readonly SocialConnectorConfig[];
};

type SocialConfig = {
  inbound?: SocialInboundConfig;
};

function connectors(config: SocialConfig | undefined): readonly SocialConnectorConfig[] {
  return config?.inbound?.connectors ?? [];
}

function connectorById(
  configured: readonly SocialConnectorConfig[],
  id: string,
): SocialConnectorConfig | undefined {
  return configured.find((connector) => connector.id === id);
}

function resolveConfiguredSecret(
  raw: string,
  ctx: ModuleContext,
): string {
  if (raw.startsWith("$")) return process.env[raw.slice(1)] ?? "";
  if (raw.startsWith("secret:")) {
    return ctx.getSecret(raw.slice("secret:".length)) ?? "";
  }
  return raw;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestSecret(req: IncomingMessage): string | null {
  const direct = headerValue(req.headers["x-kota-social-secret"]);
  if (direct?.trim()) return direct.trim();
  const authorization = headerValue(req.headers.authorization);
  const bearerPrefix = "Bearer ";
  if (authorization?.startsWith(bearerPrefix)) {
    const token = authorization.slice(bearerPrefix.length).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function makeSocialInboundHandler(
  ctx: ModuleContext,
  configured: readonly SocialConnectorConfig[],
): ModuleRouteHandler {
  return async (req, res, params) => {
    const connectorId = params.connectorId;
    if (!connectorId) {
      jsonResponse(res, 400, { error: "Missing social connector id" });
      return;
    }
    const connector = connectorById(configured, connectorId);
    if (!connector) {
      jsonResponse(res, 404, { error: "Social connector is not configured" });
      return;
    }

    const expectedSecret = resolveConfiguredSecret(connector.webhookSecret, ctx);
    if (expectedSecret.length === 0) {
      ctx.log.warn("social: configured connector secret is unavailable", {
        connectorId,
      });
      jsonResponse(res, 503, { error: "Social connector secret is unavailable" });
      return;
    }
    const providedSecret = requestSecret(req);
    if (!providedSecret || !constantTimeEqual(providedSecret, expectedSecret)) {
      jsonResponse(res, 401, { error: "Invalid social connector secret" });
      return;
    }

    let body: InboundSignalJsonObject;
    try {
      body = (await readBody(req)) as InboundSignalJsonObject;
    } catch (err) {
      jsonResponse(res, 400, { error: (err as Error).message });
      return;
    }

    const delivery = socialDeliveryFromInboundRequest(body);
    if (!delivery.ok) {
      jsonResponse(res, 400, { error: delivery.error });
      return;
    }

    const receivedAt = new Date().toISOString();
    const emitted = emitSocialInboundSignal(
      ctx.events,
      socialDeliveryToInboundSignal(delivery.value, {
        projectId: deriveProjectId(ctx.cwd),
        receivedAt,
        connector,
      }),
    );
    if (!emitted.emitted) {
      jsonResponse(res, 400, { error: emitted.error });
      return;
    }

    jsonResponse(res, 200, {
      ok: true,
      event: inboundSignalReceived.name,
      projectId: emitted.payload.projectId,
      provider: emitted.payload.provider,
      channel: emitted.payload.channel,
      sourceId: emitted.payload.sourceId,
      actorTrust: emitted.payload.actor.trust,
      listeners:
        ctx.events.listenerCount(inboundSignalReceived.name) +
        ctx.events.listenerCount("*"),
    });
  };
}

function socialRoutes(ctx: ModuleContext): RouteRegistration[] {
  const configured = connectors(ctx.getModuleConfig<SocialConfig>());
  if (configured.length === 0) return [];

  return [
    {
      method: "POST",
      path: "/api/webhooks/social/:connectorId",
      bypassAuth: true,
      handler: makeSocialInboundHandler(ctx, configured),
    },
  ];
}

const socialModule: KotaModule = {
  name: "social",
  version: "1.0.0",
  description: "Configured social platform inbound signal adapters",
  dependencies: ["inbound-signals"],
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      inbound: {
        type: "object",
        additionalProperties: false,
        properties: {
          connectors: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "provider", "accountId", "webhookSecret"],
              properties: {
                id: { type: "string", minLength: 1 },
                provider: { type: "string", enum: ["x"] },
                accountId: { type: "string", minLength: 1 },
                webhookSecret: { type: "string", minLength: 1 },
                trustedActorIds: {
                  type: "array",
                  items: { type: "string", minLength: 1 },
                  uniqueItems: true,
                },
                trustedHandles: {
                  type: "array",
                  items: { type: "string", minLength: 1 },
                  uniqueItems: true,
                },
                blockedActorIds: {
                  type: "array",
                  items: { type: "string", minLength: 1 },
                  uniqueItems: true,
                },
                blockedHandles: {
                  type: "array",
                  items: { type: "string", minLength: 1 },
                  uniqueItems: true,
                },
              },
            },
          },
        },
      },
    },
  },
  routes: socialRoutes,
};

export default socialModule;
