/**
 * Webhook extension — routes notification events to configured HTTP endpoints.
 *
 * Subscribes to the same bus events as the Telegram extension and POSTs a JSON
 * payload to each configured URL. No channels, tools, commands, or workflows.
 *
 * Config (kota.config under the "webhook" key):
 *   { urls: string[], events?: string[] }
 *
 * If `events` is omitted, all four notification events are active.
 * If `urls` is empty or the extension is not configured, the module is a no-op.
 */

import type { KotaExtension } from "../extension-types.js";

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
};

async function postWebhook(
  url: string,
  event: string,
  payload: Record<string, unknown>,
  log: { warn: (msg: string) => void },
): Promise<void> {
  const body = JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      log.warn(`Webhook POST to ${url} returned ${res.status}`);
    }
  } catch (err) {
    log.warn(`Webhook POST to ${url} failed: ${(err as Error).message}`);
  }
}

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

    for (const event of NOTIFICATION_EVENTS) {
      if (!enabledEvents.has(event)) continue;
      const unsub = ctx.events.subscribe(event, (payload) => {
        for (const url of urls) {
          void postWebhook(url, event, payload, ctx.log);
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
