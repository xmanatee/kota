/**
 * Webhook module — owns the generic inbound HTTP→bus event-trigger
 * surface and the outbound webhook notification channel.
 *
 * Inbound: contributes `POST /api/events/:name`, the bearer-token-protected
 * surface external systems (CI, ad-hoc curl, non-GitHub webhooks) use to
 * fire a typed bus event by name. The route reaches the bus through
 * `ctx.events`, not by importing the core event bus directly.
 *
 * Outbound: subscribes to the same bus events as the Telegram module and
 * POSTs a JSON payload to each configured URL.
 *
 * Config (kota.config under the "webhook" key):
 *   { urls: string[], events?: string[], retries?: number, retryDelayMs?: number }
 *
 * If `events` is omitted, all notification events are active.
 * If `urls` is empty or the module is not configured, outbound delivery is
 * a no-op. The inbound `/api/events/:name` route is registered regardless.
 * `retries` defaults to 3; `retryDelayMs` defaults to 1000.
 */

import { Command } from "commander";
import { loadConfig } from "#core/config/config.js";
import type { BusEvents } from "#core/events/event-bus.js";
import type { KotaModule } from "#core/modules/module-types.js";
import type { WebhookClient } from "#core/server/kota-client.js";
import { postWithRetry } from "#modules/notification/index.js";
import { registerWebhookCommands } from "./cli.js";
import { webhookConfigSlice } from "./config-slice.js";
import { eventTriggerRoutes } from "./event-trigger-routes.js";
import { webhookSecretControlRoutes } from "./secret-routes.js";
import { webhookTriggerControlRoutes } from "./trigger-route.js";
import {
  generateWebhookSecret,
  listWebhooks,
  removeWebhookSecret,
} from "./webhook-operations.js";

const NOTIFICATION_EVENTS = [
  "workflow.failure.alert",
  "workflow.attention.digest",
  "workflow.approval.expired",
] as const satisfies readonly (keyof BusEvents)[];

type WebhookConfig = {
  /** One or more POST endpoints to notify. */
  urls: string[];
  /** Subset of notification events to forward. Defaults to all. */
  events?: string[];
  /** Number of retry attempts after the initial try. Default: 3. */
  retries?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 1000. */
  retryDelayMs?: number;
};

let unsubs: (() => void)[] = [];

const webhookModule: KotaModule = {
  name: "webhook",
  version: "1.0.0",
  description:
    "Inbound HTTP→bus event-trigger route (POST /api/events/:name) and outbound HTTP webhook notification channel",
  dependencies: ["notification", "rendering"],
  configSlices: [webhookConfigSlice],

  onLoad: (ctx) => {
    const config = ctx.getModuleConfig<WebhookConfig>();
    if (!config?.urls?.length) return;

    const urls = config.urls;
    const enabledEvents = new Set(config.events ?? NOTIFICATION_EVENTS);
    const retryOptions = { retries: config.retries, baseDelayMs: config.retryDelayMs };

    const forward = (event: string, payload: Record<string, unknown>) => {
      const body = JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload });
      for (const url of urls) {
        void postWithRetry(url, body, ctx.log, retryOptions);
      }
    };

    for (const event of NOTIFICATION_EVENTS) {
      if (!enabledEvents.has(event)) continue;
      unsubs.push(ctx.events.subscribe(event, (payload) => forward(event, payload as Record<string, unknown>)));
    }

    // approval.requested and owner.question.asked are always forwarded when the
    // module is configured, independent of the events filter (mirrors Slack and
    // Telegram behavior). Both are urgent, actionable escalations.
    unsubs.push(
      ctx.events.subscribe("approval.requested", (payload) =>
        forward("approval.requested", payload as Record<string, unknown>),
      ),
    );
    unsubs.push(
      ctx.events.subscribe("owner.question.asked", (payload) =>
        forward("owner.question.asked", payload as Record<string, unknown>),
      ),
    );
  },

  onUnload: () => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
  },

  commands: (ctx) => {
    const root = new Command("webhook").description(
      "Manage inbound webhook secrets for workflow triggers",
    );
    registerWebhookCommands(root, ctx);
    return [root];
  },

  routes: (ctx) => eventTriggerRoutes(ctx),
  controlRoutes: (ctx) => [
    ...webhookTriggerControlRoutes(() => loadConfig(ctx.cwd)),
    ...webhookSecretControlRoutes(ctx),
  ],
  localClient: (ctx) => {
    const webhook: WebhookClient = {
      async list() {
        return listWebhooks(ctx);
      },
      async secretGenerate(workflow) {
        return generateWebhookSecret(ctx, workflow);
      },
      async secretRemove(workflow) {
        return removeWebhookSecret(ctx, workflow);
      },
    };
    return { webhook };
  },
};

export default webhookModule;
