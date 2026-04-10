/**
 * Memory module — persistent memory across sessions.
 *
 * Registers the `memory` tool in the `management` group and the `kota memory`
 * operator CLI commands.
 */

import { Command } from "commander";
import type { KotaModule } from "../../module-types.js";
import { registerMemoryCommands } from "./cli.js";
import { memoryTool, runMemory } from "./memory.js";
import { memoryRoutes } from "./routes.js";

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
  skills: [{ name: "memory", promptPath: "src/modules/skills/memory.md" }],

  commands: () => {
    const root = new Command("__root__");
    registerMemoryCommands(root);
    return root.commands as Command[];
  },

  routes: () => memoryRoutes(),
};

export default memoryModule;
