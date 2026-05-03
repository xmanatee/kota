/**
 * Audit namespace client contract.
 *
 * The guardrails-audit module owns its KotaClient namespace surface
 * end-to-end: this file declares the request/response types and the
 * `AuditClient` interface that the `KotaClient` aggregate composes. Both
 * the local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(link)` in `index.ts`) realize this
 * contract; the `kota audit` CLI consumes it through `ctx.client.audit`.
 */

/**
 * A guardrail audit entry as the CLI surfaces it. Mirrors the in-process
 * `AuditEntry` but is declared on the contract surface so the daemon and
 * local implementors share the same wire shape without coupling clients
 * to the core audit-store types.
 */
export type AuditListEntry = {
  ts: string;
  tool: string;
  risk: string;
  policy: string;
  reason: string;
  session?: string;
};

/**
 * Filter for `AuditClient.list`. Mirrors the existing CLI flags and the
 * `/audit` query params so callers do not need to know which transport
 * answered.
 */
export type AuditListFilter = {
  tool?: string;
  risk?: "safe" | "low" | "moderate" | "dangerous" | "critical";
  policy?: "allow" | "confirm" | "deny";
  since?: string;
  session?: string;
  limit?: number;
};

export type AuditListResult = {
  entries: AuditListEntry[];
};

/**
 * Audit-trail operations.
 *
 * `list` returns guardrail assessments newest-first. The local handler
 * reads `.kota/audit.jsonl` through the audit store; the daemon handler
 * reads through the same store the daemon-loaded `guardrails-audit`
 * module owns. Both transports return the same shape.
 */
export interface AuditClient {
  list(filter?: AuditListFilter): Promise<AuditListResult>;
}
