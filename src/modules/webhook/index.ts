/**
 * Webhook module — routes notification events to configured HTTP endpoints,
 * and provides CLI commands for managing inbound webhook secrets.
 *
 * Subscribes to the same bus events as the Telegram module and POSTs a JSON
 * payload to each configured URL. No channels, tools, or workflows.
 *
 * Config (kota.config under the "webhook" key):
 *   { urls: string[], events?: string[], retries?: number, retryDelayMs?: number }
 *
 * If `events` is omitted, all notification events are active.
 * If `urls` is empty or the module is not configured, the module is a no-op.
 * `retries` defaults to 3; `retryDelayMs` defaults to 1000.
 */

import { Command } from "commander";
import type { KotaModule } from "../../module-types.js";
import { postWithRetry } from "../notify-retry.js";
import { registerWebhookCommands } from "./cli.js";

const NOTIFICATION_EVENTS = [
  "workflow.failure.alert",
  "workflow.budget.exceeded",
  "workflow.budget.warning",
  "workflow.attention.digest",
  "workflow.cost.limit.reached",
  "workflow.cost.anomaly",
  "workflow.approval.expired",
] as const;

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
  description: "HTTP webhook notification channel for KOTA workflow events",

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

    // approval.requested is always forwarded when the module is configured,
    // independent of the events filter (mirrors Slack and Telegram behavior).
    unsubs.push(
      ctx.events.subscribe("approval.requested", (payload) =>
        forward("approval.requested", payload as Record<string, unknown>),
      ),
    );
  },

  onUnload: () => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
  },

  commands: () => {
    const root = new Command("webhook").description(
      "Manage inbound webhook secrets for workflow triggers",
    );
    registerWebhookCommands(root);
    return [root];
  },
};

export default webhookModule;
