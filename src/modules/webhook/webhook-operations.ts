/**
 * Shared mutation/read logic for `kota webhook list` /
 * `kota webhook secret generate` / `kota webhook secret remove`.
 *
 * Both the CLI subcommands (via the local-client handler) and the daemon
 * HTTP routes route through these functions so the two transports cannot
 * diverge on what gets written into `.kota/config.json`.
 */
import { randomBytes } from "node:crypto";
import { loadConfig, updateProjectConfig } from "#core/config/config.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  WebhookListResult,
  WebhookSecretGenerateResult,
  WebhookSecretRemoveResult,
} from "./client.js";
// Side-effect import: registers the webhook config slice so loadConfig
// sanitizes/merges the webhooks key when this module's operations run.
import "./config-slice.js";

/**
 * Enumerate workflows with a webhook trigger and whether a secret is
 * configured for each. The list reflects the loaded module set's contributed
 * workflow definitions filtered to those with a webhook trigger.
 */
export function listWebhooks(ctx: ModuleContext): WebhookListResult {
  const definitions = ctx.getContributedWorkflows();
  const webhookDefs = definitions.filter((d) =>
    d.triggers.some((t) => t.webhook),
  );
  const config = loadConfig(ctx.cwd);
  const entries = webhookDefs.map((def) => ({
    workflow: def.name,
    hasSecret: !!config.webhooks?.[def.name]?.secret,
  }));
  return { entries };
}

/**
 * Generate and persist a fresh HMAC secret for the named workflow. Reports
 * `overwrote: true` when an existing secret was replaced so the caller can
 * surface a clear "rotated" message.
 */
export function generateWebhookSecret(
  ctx: ModuleContext,
  workflow: string,
): WebhookSecretGenerateResult {
  const existing = loadConfig(ctx.cwd).webhooks?.[workflow]?.secret;
  const secret = randomBytes(32).toString("hex");

  updateProjectConfig(ctx.cwd, (raw) => ({
    ...raw,
    webhooks: {
      ...(raw.webhooks ?? {}),
      [workflow]: { secret },
    },
  }));

  return {
    workflow,
    secret,
    overwrote: !!existing,
  };
}

/**
 * Remove the persisted webhook secret for the named workflow. Returns
 * `removed: false` when no secret was configured so callers can render the
 * no-op result instead of pretending to have made a change.
 */
export function removeWebhookSecret(
  ctx: ModuleContext,
  workflow: string,
): WebhookSecretRemoveResult {
  const config = loadConfig(ctx.cwd);
  if (!config.webhooks?.[workflow]) {
    return { ok: true, workflow, removed: false };
  }

  updateProjectConfig(ctx.cwd, (raw) => {
    const webhooks = { ...(raw.webhooks ?? {}) };
    delete webhooks[workflow];
    if (Object.keys(webhooks).length === 0) {
      const { webhooks: _removed, ...rest } = raw;
      return rest;
    }
    return { ...raw, webhooks };
  });

  return { ok: true, workflow, removed: true };
}
