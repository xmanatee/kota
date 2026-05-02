/**
 * Memory module — persistent memory across sessions.
 *
 * Owns the file-based MemoryStore implementation and registers it as the
 * `default` memory provider. Contributes the `memory` tool in the `management`
 * group, the `kota memory` operator CLI commands, and the `/api/memory` HTTP
 * routes.
 *
 * Storage: `.kota/memory.json` (project) and `~/.kota/memory.json` (global).
 */


import { Command } from "commander";
import { CAPABILITY_READINESS_PROVIDER_TYPE } from "#core/daemon/capability-readiness.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
  getMemoryProvider,
  MEMORY_PROVIDER_TOKEN,
} from "#core/modules/provider-registry.js";
import type { MemoryClient } from "#core/server/kota-client.js";
import { readOnlyDaemonEffect } from "#core/tools/effect.js";
import { createMemoryReadinessSource } from "./capability-readiness.js";
import { registerMemoryCommands } from "./cli.js";
import { memoryTool, runMemory } from "./memory.js";
import { memoryRoutes } from "./routes.js";
import { getMemoryStore } from "./store.js";

const memoryModule: KotaModule = {
  name: "memory",
  version: "1.0.0",
  description: "Persistent memory across sessions (save/search/list/update/delete)",
  dependencies: ["rendering"],
  tools: [
    {
      tool: memoryTool,
      runner: runMemory,
      effect: readOnlyDaemonEffect(),
      group: "management",
    },
  ],
  skills: [{ name: "memory", promptPath: "src/modules/memory/memory.md" }],

  localClient: () => {
    const handler: MemoryClient = {
      async list(limit) {
        const provider = getMemoryProvider();
        const all = provider.list();
        const slice = limit !== undefined ? all.slice(0, limit) : all;
        return {
          entries: slice.map((entry) => ({
            id: entry.id,
            created: entry.created,
            content: entry.content,
          })),
        };
      },
      async add(content, tags) {
        const provider = getMemoryProvider();
        const id = provider.save(content, tags ?? []);
        return { id };
      },
      async delete(id) {
        const provider = getMemoryProvider();
        const ok = provider.delete(id);
        return ok ? { ok: true } : { ok: false, reason: "not_found" };
      },
      async search(query, filter) {
        const provider = getMemoryProvider();
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
            entries: results.map((m) => ({ id: m.id, created: m.created, content: m.content })),
          };
        }
        const results = provider
          .search(query, { tag: filter?.tag, since: filter?.since })
          .slice(0, limit);
        return {
          ok: true,
          entries: results.map((m) => ({ id: m.id, created: m.created, content: m.content })),
        };
      },
      async reindex() {
        const provider = getMemoryProvider();
        return provider.reindex();
      },
    };
    return { memory: handler };
  },

  onLoad: (ctx: ModuleRuntimeContext) => {
    const store = getMemoryStore();
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

  routes: () => memoryRoutes(),
};

export default memoryModule;
