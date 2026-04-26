/**
 * Webhook module config slice.
 *
 * Owns the top-level `webhooks` field of `.kota/config.json` —
 * a per-workflow secret table used by `POST /webhooks/:workflowName` for
 * HMAC signature verification on inbound deliveries.
 */

import { type ModuleConfigSlice, registerConfigSlice } from "#core/config/config-slice.js";

export type WebhookSecretsConfig = Record<string, { secret: string }>;

declare module "#core/config/config-slice.js" {
  interface KotaModuleConfigRegistry {
    webhooks: WebhookSecretsConfig;
  }
}

function sanitizeWebhooks(raw: unknown): WebhookSecretsConfig | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: WebhookSecretsConfig = {};
  for (const [name, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val !== "object" || val === null || Array.isArray(val)) continue;
    const entry = val as Record<string, unknown>;
    if (typeof entry.secret === "string" && entry.secret) {
      out[name] = { secret: entry.secret };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export const webhookConfigSlice: ModuleConfigSlice<"webhooks"> = {
  key: "webhooks",
  description: "Per-workflow webhook secrets for signature verification",
  sanitize: sanitizeWebhooks,
  merge: (base, override) => ({ ...base, ...override }),
  schemaSource: {
    relativePath: "src/modules/webhook/config-slice.ts",
    typeName: "WebhookSecretsConfig",
  },
};

// Self-register on import so direct importers (operations, CLI helpers,
// daemon routes) get sanitize/merge support without depending on module
// discovery or loader.load to have run first.
registerConfigSlice(webhookConfigSlice, "webhook");
