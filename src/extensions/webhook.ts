/**
 * Webhook extension — routes notification events to configured HTTP endpoints.
 *
 * Subscribes to the same bus events as the Telegram extension and POSTs a JSON
 * payload to each configured URL. No channels, tools, commands, or workflows.
 *
 * Config (kota.config under the "webhook" key):
 *   { urls: string[], events?: string[], retries?: number, retryDelayMs?: number }
 *
 * If `events` is omitted, all four notification events are active.
 * If `urls` is empty or the extension is not configured, the module is a no-op.
 * `retries` defaults to 3; `retryDelayMs` defaults to 1000.
 */

import type { KotaExtension } from "../extension-types.js";
import { postWithRetry } from "./notify-retry.js";

const NOTIFICATION_EVENTS = [
  "workflow.failure.alert",
  "workflow.budget.exceeded",
  "workflow.attention.digest",
  "workflow.cost.limit.reached",
] as const;

type WebhookConfig = {
  /** One or more POST endpoints to notify. */
  urls: string[];
  /** Subset of notification events to forward. Defaults to all four. */
  events?: string[];
  /** Number of retry attempts after the initial try. Default: 3. */
  retries?: number;
  /** Base delay in milliseconds for exponential backoff. Default: 1000. */
  retryDelayMs?: number;
};

let unsubs: (() => void)[] = [];

const webhookModule: KotaExtension = {
  name: "webhook",
  version: "1.0.0",
  description: "HTTP webhook notification channel for KOTA workflow events",

  onLoad: (ctx) => {
    const config = ctx.getExtensionConfig<WebhookConfig>();
    if (!config?.urls?.length) return;

    const urls = config.urls;
    const enabledEvents = new Set(config.events ?? NOTIFICATION_EVENTS);
    const retryOptions = { retries: config.retries, baseDelayMs: config.retryDelayMs };

    for (const event of NOTIFICATION_EVENTS) {
      if (!enabledEvents.has(event)) continue;
      const unsub = ctx.events.subscribe(event, (payload) => {
        const body = JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload });
        for (const url of urls) {
          void postWithRetry(url, body, ctx.log, retryOptions);
        }
      });
      unsubs.push(unsub);
    }
  },

  onUnload: () => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
  },
};

export default webhookModule;
