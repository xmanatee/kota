import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type {
  McpCacheHints,
  McpListPromptsPage,
  McpListResourcesPage,
  McpListResourceTemplatesPage,
} from "./client.js";
import type { McpRemoteSkillCatalog } from "./client-remote-skills.js";
import type { McpOperationEntry } from "./manager-tool-registry.js";

export type McpCachedListOperationKind =
  | "resources/list"
  | "resources/templates/list"
  | "prompts/list";

type McpCacheableCatalog =
  | McpListResourcesPage
  | McpListResourceTemplatesPage
  | McpListPromptsPage;

type CacheReason = "fresh" | "missing" | "expired" | "ttl-not-positive" | "list_changed";

type CatalogCacheEntry<TCatalog extends McpCacheableCatalog> = {
  catalog: TCatalog;
  receivedAtMs: number;
};

type CacheMetadata = McpCacheHints & {
  server: string;
  operation: McpCachedListOperationKind | "skills/list";
  source: "cache" | "server";
  reason: CacheReason;
  receivedAt: string;
  expiresAt: string | null;
};

type SkillCacheEntry = {
  catalog: Extract<McpRemoteSkillCatalog, { status: "enumerated" }>;
  receivedAtMs: number;
};

export class McpOperationCache {
  private catalogs = new Map<string, CatalogCacheEntry<McpCacheableCatalog>>();
  private catalogInvalidations = new Map<string, "list_changed">();
  private skillCatalogs = new Map<string, SkillCacheEntry>();
  private skillInvalidations = new Map<string, "list_changed">();

  invalidateLists(serverName: string, operations: McpCachedListOperationKind[]): void {
    for (const operation of operations) {
      const prefix = this.catalogKey(serverName, operation);
      for (const key of this.catalogs.keys()) {
        if (key.startsWith(prefix)) this.catalogs.delete(key);
      }
      this.catalogInvalidations.set(prefix, "list_changed");
    }
  }

  invalidateSkills(serverName: string): void {
    const prefix = this.skillKey(serverName);
    for (const key of this.skillCatalogs.keys()) {
      if (key.startsWith(prefix)) this.skillCatalogs.delete(key);
    }
    this.skillInvalidations.set(prefix, "list_changed");
  }

  async listCatalog<TCatalog extends McpCacheableCatalog>(
    entry: McpOperationEntry,
    operation: McpCachedListOperationKind,
    fetchCatalog: () => Promise<TCatalog>,
  ): Promise<{ catalog: TCatalog; meta: KotaJsonObject }> {
    const key = this.catalogKey(entry.serverName, operation, entry.client.getCacheAuthorizationContextKey());
    const prefix = this.catalogKey(entry.serverName, operation);
    const cached = this.catalogs.get(key) as CatalogCacheEntry<TCatalog> | undefined;
    const now = Date.now();
    if (cached && cached.catalog.cache.ttlMs > 0 && now < cached.receivedAtMs + cached.catalog.cache.ttlMs) {
      return {
        catalog: cached.catalog,
        meta: { mcp: { cache: [this.metadata(entry.serverName, operation, "cache", "fresh", cached.catalog, cached.receivedAtMs)] } },
      };
    }
    const reason = this.catalogInvalidations.get(prefix)
      ?? this.missReason(cached?.catalog.cache, cached !== undefined);
    const catalog = await fetchCatalog();
    const receivedAtMs = Date.now();
    if (catalog.cache.ttlMs > 0) this.catalogs.set(key, { catalog, receivedAtMs });
    else this.catalogs.delete(key);
    this.catalogInvalidations.delete(prefix);
    return {
      catalog,
      meta: { mcp: { cache: [this.metadata(entry.serverName, operation, "server", reason, catalog, receivedAtMs)] } },
    };
  }

  async remoteSkillCatalog(
    entry: McpOperationEntry,
  ): Promise<{ catalog: McpRemoteSkillCatalog; meta?: KotaJsonObject }> {
    const key = this.skillKey(entry.serverName, entry.client.getCacheAuthorizationContextKey());
    const prefix = this.skillKey(entry.serverName);
    const cached = this.skillCatalogs.get(key);
    const now = Date.now();
    if (cached && cached.catalog.cache.ttlMs > 0 && now < cached.receivedAtMs + cached.catalog.cache.ttlMs) {
      return {
        catalog: cached.catalog,
        meta: { mcp: { cache: [this.metadata(entry.serverName, "skills/list", "cache", "fresh", cached.catalog, cached.receivedAtMs)] } },
      };
    }
    const reason = this.skillInvalidations.get(prefix)
      ?? this.missReason(cached?.catalog.cache, cached !== undefined);
    const catalog = await entry.client.listRemoteSkills();
    if (catalog.status !== "enumerated") {
      this.skillCatalogs.delete(key);
      this.skillInvalidations.delete(prefix);
      return { catalog };
    }
    const receivedAtMs = Date.now();
    if (catalog.cache.ttlMs > 0) this.skillCatalogs.set(key, { catalog, receivedAtMs });
    else this.skillCatalogs.delete(key);
    this.skillInvalidations.delete(prefix);
    return {
      catalog,
      meta: { mcp: { cache: [this.metadata(entry.serverName, "skills/list", "server", reason, catalog, receivedAtMs)] } },
    };
  }

  clear(): void {
    this.catalogs.clear();
    this.catalogInvalidations.clear();
    this.skillCatalogs.clear();
    this.skillInvalidations.clear();
  }

  private missReason(cache: McpCacheHints | undefined, exists: boolean): CacheReason {
    if (!exists) return "missing";
    return cache && cache.ttlMs <= 0 ? "ttl-not-positive" : "expired";
  }

  private metadata(
    server: string,
    operation: CacheMetadata["operation"],
    source: CacheMetadata["source"],
    reason: CacheReason,
    value: { cache: McpCacheHints },
    receivedAtMs: number,
  ): CacheMetadata {
    return {
      server,
      operation,
      source,
      reason: value.cache.ttlMs <= 0 && reason === "missing" ? "ttl-not-positive" : reason,
      ...value.cache,
      receivedAt: new Date(receivedAtMs).toISOString(),
      expiresAt: value.cache.ttlMs > 0
        ? new Date(receivedAtMs + value.cache.ttlMs).toISOString()
        : null,
    };
  }

  private catalogKey(serverName: string, operation: McpCachedListOperationKind, auth = ""): string {
    return `${serverName}\u0000${operation}\u0000${auth}`;
  }

  private skillKey(serverName: string, auth = ""): string {
    return `${serverName}\u0000skills/list\u0000${auth}`;
  }
}
