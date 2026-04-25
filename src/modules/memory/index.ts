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
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import { getMemoryProvider } from "#core/modules/provider-registry.js";
import type { MemoryClient } from "#core/server/kota-client.js";
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
      risk: "safe",
      kind: "discovery",
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
    };
    return { memory: handler };
  },

  onLoad: (ctx: ModuleContext) => {
    ctx.registerProvider("memory", getMemoryStore());
  },

  commands: (ctx) => {
    const root = new Command("__root__");
    registerMemoryCommands(root, ctx);
    return root.commands as Command[];
  },

  routes: () => memoryRoutes(),
};

export default memoryModule;
