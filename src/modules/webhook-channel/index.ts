import type { ChannelDef } from "#core/channels/channel.js";
import type {
  KotaModule,
  ModuleContext,
  RouteRegistration,
} from "#core/modules/module-types.js";
import {
  clearSessions,
  makeWebhookChannelHandler,
  type WebhookChannelConfig,
} from "./handler.js";

export type {
  SourceRoute,
  WebhookChannelConfig,
  WebhookPayload,
} from "./handler.js";
export {
  makeWebhookChannelHandler,
  resolveSourceId,
  verifyHmacSignature,
} from "./handler.js";

// ─── Channel definition ─────────────────────────────────────────────────────

function makeChannelDef(ctx: ModuleContext): ChannelDef {
  return {
    name: "webhook-channel",
    description:
      "Generic inbound HTTP webhook channel — creates agent sessions from JSON payloads",
    create() {
      return {
        async start() {
          ctx.log.info("webhook-channel: channel started");
        },
        stop() {
          clearSessions();
          ctx.log.info("webhook-channel: channel stopped");
        },
      };
    },
  };
}

// ─── Module ─────────────────────────────────────────────────────────────────

const webhookChannelModule: KotaModule = {
  name: "webhook-channel",
  version: "1.0.0",
  description:
    "Inbound webhook-to-session channel — external services POST JSON to create agent sessions",

  channels: (ctx) => [makeChannelDef(ctx)],

  routes: (ctx): RouteRegistration[] => {
    const config = ctx.getModuleConfig<WebhookChannelConfig>() ?? {};
    const handler = makeWebhookChannelHandler(ctx, config);

    const routes: RouteRegistration[] = [
      {
        method: "POST",
        path: "/api/channels/webhook",
        bypassAuth: true,
        handler,
      },
    ];

    if (config.sources) {
      for (const sourceId of Object.keys(config.sources)) {
        routes.push({
          method: "POST",
          path: `/api/channels/webhook/${encodeURIComponent(sourceId)}`,
          bypassAuth: true,
          handler,
        });
      }
    }

    return routes;
  },
};

export default webhookChannelModule;
