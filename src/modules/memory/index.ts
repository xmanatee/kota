import { Command } from "commander";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import { MEMORY_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { readOnlyDaemonEffect } from "#core/tools/effect.js";
import { createMemoryReadinessSource } from "./capability-readiness.js";
import { registerMemoryCommands } from "./cli.js";
import type {
  MemoryAddResult,
  MemoryClient,
  MemoryDeleteResult,
  MemoryListResult,
  MemoryReindexResult,
  MemorySearchResult,
} from "./client.js";
import { memoryTool, runMemory } from "./memory.js";
import { memoryRoutes } from "./routes.js";
import {
  createMemoryScopeStores,
  type MemoryScopeStores,
} from "./scope.js";
import { getScopeMemoryStore } from "./store.js";
import { memoryUiSurfaceSource } from "./ui-surface.js";

const memoryModule: KotaModule = {
  name: "memory",
  version: "1.0.0",
  description: "Persistent memory across sessions (save/search/list/update/delete)",
  dependencies: ["rendering"],
  uiSurfaces: [memoryUiSurfaceSource],
  tools: (ctx) => [
    {
      tool: memoryTool,
      runner: (input) => {
        const provider = ctx.getProvider(MEMORY_PROVIDER_TOKEN);
        if (!provider) throw new Error("memory provider is not registered");
        return runMemory(input, provider);
      },
      effect: readOnlyDaemonEffect(),
      group: "management",
    },
  ],
  skills: [{ name: "memory", promptPath: "src/modules/memory/memory.md" }],

  localClient: (ctx) => {
    const scopeStores = createMemoryScopeStores(ctx.cwd, () => {
      const provider = ctx.getProvider(MEMORY_PROVIDER_TOKEN);
      if (!provider) throw new Error("memory provider is not registered");
      return provider;
    }, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE));
    const handler: MemoryClient = {
      async list(filter) {
        const provider = resolveMemoryProvider(scopeStores, filter?.scopeId);
        const all = provider.list();
        const slice =
          filter?.limit !== undefined ? all.slice(0, filter.limit) : all;
        return {
            entries: slice.map((entry) => ({
              id: entry.id,
              created: entry.created,
              ...(entry.updated && { updated: entry.updated }),
              content: entry.content,
              ...(entry.provenance && { provenance: entry.provenance }),
              ...(entry.freshness && { freshness: entry.freshness }),
            })),
        };
      },
      async add(content, tags, scopeSelector) {
        const provider = resolveMemoryProvider(scopeStores, scopeSelector?.scopeId);
        const id = provider.save(content, tags ?? []);
        return { id };
      },
      async delete(id, scopeSelector) {
        const provider = resolveMemoryProvider(scopeStores, scopeSelector?.scopeId);
        const ok = provider.delete(id);
        return ok ? { ok: true } : { ok: false, reason: "not_found" };
      },
      async search(query, filter) {
        const provider = resolveMemoryProvider(scopeStores, filter?.scopeId);
        const limit = filter?.limit ?? 20;
        if (filter?.semantic) {
          if (!provider.supportsSemanticSearch()) {
            return { ok: false, reason: "semantic_unavailable" };
          }
          const results = await provider.semanticSearch(query, limit, {
            tag: filter.tag,
            since: filter.since,
          });
          return {
            ok: true,
            entries: results.map((m) => ({
              id: m.id,
              created: m.created,
              ...(m.updated && { updated: m.updated }),
              content: m.content,
              ...(m.provenance && { provenance: m.provenance }),
              ...(m.freshness && { freshness: m.freshness }),
            })),
          };
        }
        const results = provider
          .search(query, { tag: filter?.tag, since: filter?.since })
          .slice(0, limit);
        return {
          ok: true,
          entries: results.map((m) => ({
            id: m.id,
            created: m.created,
            ...(m.updated && { updated: m.updated }),
            content: m.content,
            ...(m.provenance && { provenance: m.provenance }),
            ...(m.freshness && { freshness: m.freshness }),
          })),
        };
      },
      async reindex(scopeSelector) {
        const provider = resolveMemoryProvider(scopeStores, scopeSelector?.scopeId);
        return provider.reindex();
      },
    };
    return { memory: handler };
  },

  daemonClient: (link) => ({ memory: buildMemoryDaemonHandler(link) }),

  onLoad: (ctx: ModuleRuntimeContext) => {
    const store = getScopeMemoryStore(ctx.cwd);
    ctx.registerProvider(MEMORY_PROVIDER_TOKEN, store);
    ctx.registerProvider(
      CAPABILITY_READINESS_PROVIDER_TYPE,
      createMemoryReadinessSource(store),
    );
  },

  commands: (ctx) => {
    const root = new Command("__root__");
    registerMemoryCommands(root, ctx);
    return root.commands as Command[];
  },

  routes: (ctx) =>
    memoryRoutes(createMemoryScopeStores(ctx.cwd, () => {
      const provider = ctx.getProvider(MEMORY_PROVIDER_TOKEN);
      if (!provider) throw new Error("memory provider is not registered");
      return provider;
    }, () => ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE))),
};

function buildMemoryDaemonHandler(link: DaemonTransport): MemoryClient {
  return {
    list: async (filter): Promise<MemoryListResult> => {
      const query = scopeQuery(filter?.scopeId);
      const result = await link.requestStrict<{
        entries: {
          id: string;
          tags: string[];
          created: string;
          updated?: string;
          excerpt: string;
          provenance?: MemoryListResult["entries"][number]["provenance"];
          freshness?: MemoryListResult["entries"][number]["freshness"];
        }[];
      }>("GET", `/api/memory${query}`);
      const slice = result.entries.slice(
        0,
        filter?.limit ?? Number.POSITIVE_INFINITY,
      );
      return {
        entries: slice.map((entry) => ({
          id: entry.id,
          created: entry.created,
          ...(entry.updated && { updated: entry.updated }),
          content: entry.excerpt,
          ...(entry.provenance && { provenance: entry.provenance }),
          ...(entry.freshness && { freshness: entry.freshness }),
        })),
      };
    },
    add: async (content, tags, scopeSelector): Promise<MemoryAddResult> => {
      const query = scopeQuery(scopeSelector?.scopeId);
      const result = await link.requestStrict<{ id: string }>(
        "POST",
        `/api/memory${query}`,
        { content, tags: tags ?? [] },
      );
      return { id: result.id };
    },
    delete: async (id, scopeSelector): Promise<MemoryDeleteResult> => {
      const query = scopeQuery(scopeSelector?.scopeId);
      const result = await requestNullableMemoryRoute<{ deleted: string }>(
        link,
        "DELETE",
        `/api/memory/${encodeURIComponent(id)}${query}`,
      );
      return result ? { ok: true } : { ok: false, reason: "not_found" };
    },
    search: async (query, filter): Promise<MemorySearchResult> => {
      const params = new URLSearchParams();
      params.set("q", query);
      if (filter?.tag) params.set("tag", filter.tag);
      if (filter?.since) params.set("since", filter.since);
      if (filter?.semantic) params.set("semantic", "true");
      if (filter?.limit !== undefined) params.set("limit", String(filter.limit));
      if (filter?.scopeId) params.set("scopeId", filter.scopeId);
      return link.requestStrict<MemorySearchResult>(
        "GET",
        `/api/memory/search?${params.toString()}`,
      );
    },
    reindex: async (scopeSelector): Promise<MemoryReindexResult> => {
      const query = scopeQuery(scopeSelector?.scopeId);
      return link.requestStrict<MemoryReindexResult>(
        "POST",
        `/api/memory/reindex${query}`,
      );
    },
  };
}

type MemoryRouteErrorBody = {
  error?: string;
  reason?: string;
  scopeId?: string;
};

async function requestNullableMemoryRoute<T>(
  link: DaemonTransport,
  method: string,
  path: string,
): Promise<T | null> {
  const res = await link.fetchRaw(path, { method });
  if (res.status === 404) {
    const body = await readMemoryRouteError(res);
    if (body?.reason === "unknown_scope" && body.scopeId) {
      throw new Error(`Unknown scope: ${body.scopeId}`);
    }
    return null;
  }
  if (!res.ok) {
    const body = await readMemoryRouteError(res);
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return (await res.json()) as T;
}

async function readMemoryRouteError(
  res: Response,
): Promise<MemoryRouteErrorBody | null> {
  try {
    const parsed = (await res.json()) as MemoryRouteErrorBody;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function resolveMemoryProvider(
  scopeStores: MemoryScopeStores,
  scopeId: string | undefined,
) {
  const resolved = scopeStores.resolve(scopeId);
  if (!resolved.ok) {
    throw new Error(`Unknown scope: ${resolved.error.scopeId}`);
  }
  return resolved.store;
}

function scopeQuery(scopeId: string | undefined): string {
  if (!scopeId) return "";
  const params = new URLSearchParams();
  params.set("scopeId", scopeId);
  return `?${params.toString()}`;
}

export default memoryModule;
