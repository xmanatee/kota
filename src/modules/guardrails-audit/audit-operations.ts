/**
 * Shared read logic for `kota audit list` and the `/api/audit` route.
 *
 * Both the CLI subcommand (via the local-client handler) and the daemon
 * control route surface guardrail audit entries through this function so
 * the two transports share one definition of which entries get returned
 * for a given filter.
 */
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  AuditListFilter,
  AuditListResult,
} from "#core/server/kota-client.js";
import type { AuditEntry, AuditFilter } from "#core/tools/audit-store.js";
import { AuditStore, getAuditStore } from "#core/tools/audit-store.js";

const DEFAULT_LIMIT = 50;

function entryFor(entry: AuditEntry): AuditListResult["entries"][number] {
  return {
    ts: entry.ts,
    tool: entry.tool,
    risk: entry.risk,
    policy: entry.policy,
    reason: entry.reason,
    ...(entry.session !== undefined && { session: entry.session }),
  };
}

function buildFilter(filter?: AuditListFilter): AuditFilter {
  const limit = filter?.limit ?? DEFAULT_LIMIT;
  const out: AuditFilter = { limit: Math.max(1, limit) };
  if (filter?.tool) out.tool = filter.tool;
  if (filter?.risk) out.risk = filter.risk as AuditFilter["risk"];
  if (filter?.policy) out.policy = filter.policy as AuditFilter["policy"];
  if (filter?.since) out.since = filter.since;
  if (filter?.session) out.session = filter.session;
  return out;
}

/**
 * Resolve the audit store for the active module context. Prefers the
 * already-initialized in-process store when present (the daemon path has
 * one set up by `guardrails-audit.onLoad`); falls back to a fresh
 * `AuditStore` rooted at `ctx.cwd` for the CLI's `"commands"` lifecycle
 * path where `onLoad` is skipped.
 */
function resolveStore(ctx: ModuleContext): Pick<AuditStore, "query"> {
  const store = getAuditStore();
  if (store) return store;
  return new AuditStore(ctx.cwd);
}

export function listAuditEntries(
  ctx: ModuleContext,
  filter?: AuditListFilter,
): AuditListResult {
  const store = resolveStore(ctx);
  const entries = store.query(buildFilter(filter));
  return { entries: entries.map(entryFor) };
}
