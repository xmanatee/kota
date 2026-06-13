/**
 * Shared read logic for `kota audit list` and the `/api/audit` route.
 *
 * Both the CLI subcommand (via the local-client handler) and the daemon
 * control route surface guardrail audit entries through this function so
 * the two transports share one definition of which entries get returned
 * for a given filter.
 */
import type { ModuleCapabilityManifestProjection } from "#core/modules/module-manifest.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { AuditEntry, AuditFilter } from "#core/tools/audit-store.js";
import { AuditStore, getAuditStore } from "#core/tools/audit-store.js";
import type {
  AuditListFilter,
  AuditListResult,
  AuditManifestContext,
} from "./client.js";

const DEFAULT_LIMIT = 50;

export type AuditQueryStore = Pick<AuditStore, "query">;

export function resolveAuditManifestContext(
  toolName: string,
  manifests: readonly ModuleCapabilityManifestProjection[],
): AuditManifestContext | undefined {
  for (const manifest of manifests) {
    const effect = manifest.effects.find(
      (candidate) =>
        candidate.source === "tool" &&
        candidate.target === toolName,
    );
    if (!effect) continue;
    const capabilityIds = new Set(effect.capabilityIds);
    return {
      moduleName: manifest.moduleName,
      effect,
      capabilities: manifest.capabilities.filter((capability) =>
        capabilityIds.has(capability.id)
      ),
      dataClasses: manifest.dataClasses,
      simulation: manifest.simulation,
    };
  }
  return undefined;
}

function moduleManifestsFromContext(
  ctx: ModuleContext,
): ModuleCapabilityManifestProjection[] {
  return ctx.getModuleSummaries().flatMap((summary) =>
    summary.manifest ? [summary.manifest] : []
  );
}

function entryFor(
  entry: AuditEntry,
  manifests: readonly ModuleCapabilityManifestProjection[],
): AuditListResult["entries"][number] {
  const manifest = resolveAuditManifestContext(entry.tool, manifests);
  return {
    ts: entry.ts,
    tool: entry.tool,
    risk: entry.risk,
    policy: entry.policy,
    reason: entry.reason,
    ...(entry.session !== undefined && { session: entry.session }),
    ...(manifest !== undefined && { manifest }),
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
function resolveStore(ctx: ModuleContext): AuditQueryStore {
  const store = getAuditStore();
  if (store) return store;
  return new AuditStore(ctx.cwd);
}

export function listAuditEntriesFromStore(
  ctx: ModuleContext,
  store: AuditQueryStore,
  filter?: AuditListFilter,
): AuditListResult {
  const entries = store.query(buildFilter(filter));
  const manifests = moduleManifestsFromContext(ctx);
  return { entries: entries.map((entry) => entryFor(entry, manifests)) };
}

export function listAuditEntries(
  ctx: ModuleContext,
  filter?: AuditListFilter,
): AuditListResult {
  return listAuditEntriesFromStore(ctx, resolveStore(ctx), filter);
}
