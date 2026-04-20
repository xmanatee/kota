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
import { registerMemoryCommands } from "./cli.js";
import { memoryTool, runMemory } from "./memory.js";
import { memoryRoutes } from "./routes.js";
import { getMemoryStore } from "./store.js";

const memoryModule: KotaModule = {
  name: "memory",
  version: "1.0.0",
  description: "Persistent memory across sessions (save/search/list/update/delete)",
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

  onLoad: (ctx: ModuleContext) => {
    ctx.registerProvider("memory", getMemoryStore());
  },

  commands: () => {
    const root = new Command("__root__");
    registerMemoryCommands(root);
    return root.commands as Command[];
  },

  routes: () => memoryRoutes(),
};

export default memoryModule;
