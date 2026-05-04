/**
 * Webhook namespace client contract.
 *
 * The webhook module owns its KotaClient namespace surface end-to-end:
 * this file declares the entry/list/secret-result types and the
 * `WebhookClient` interface that the `KotaClient` aggregate composes.
 * Both the local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) realize this
 * contract; the `kota webhook` CLI subcommands and the
 * `webhook-operations.ts` shared mutators consume it through
 * `ctx.client.webhook` or by importing these types from
 * `#modules/webhook/client.js`.
 */

/**
 * A workflow surfaced by `webhook.list` with whether a webhook secret is
 * configured for it. The list reflects the loaded workflow definition set
 * filtered to webhook-triggered workflows.
 */
export type WebhookListEntry = {
  workflow: string;
  hasSecret: boolean;
};

export type WebhookListResult = {
  entries: WebhookListEntry[];
};

/**
 * Result of `webhook.secretGenerate`. The secret is returned exactly once at
 * generation time so the caller can echo it to the operator.
 */
export type WebhookSecretGenerateResult = {
  workflow: string;
  secret: string;
  /** True when an existing secret was overwritten. */
  overwrote: boolean;
};

/**
 * Result of `webhook.secretRemove`. `removed: false` indicates the workflow
 * had no secret configured; the operation is a no-op in that case.
 */
export type WebhookSecretRemoveResult =
  | { ok: true; workflow: string; removed: true }
  | { ok: true; workflow: string; removed: false };

/**
 * Webhook-secret operations.
 *
 * `list` enumerates workflows with webhook triggers and whether a secret is
 * configured for each. `secretGenerate` writes a new HMAC secret into
 * `.kota/config.json` for the given workflow and returns the secret once.
 * `secretRemove` clears the secret. All three operations work daemon-up and
 * daemon-down — the daemon-side persists through the same updateProjectConfig
 * helper the local handler uses, so config-file mutation cannot diverge.
 */
export interface WebhookClient {
  list(): Promise<WebhookListResult>;
  secretGenerate(workflow: string): Promise<WebhookSecretGenerateResult>;
  secretRemove(workflow: string): Promise<WebhookSecretRemoveResult>;
}
