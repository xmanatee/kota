/**
 * Memory extension — persistent memory across sessions.
 *
 * First built-in extension extracted using the KotaExtension protocol.
 * Registers the `memory` tool in the `management` group and the `kota memory`
 * operator CLI commands.
 */

import { Command } from "commander";
import type { KotaExtension } from "../../extension-types.js";
import { registerMemoryCommands } from "./cli.js";
import { memoryTool, runMemory } from "./memory.js";

const memoryModule: KotaExtension = {
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
  skills: [{ name: "memory", promptPath: "src/extensions/skills/memory.md" }],

  commands: () => {
    const root = new Command("__root__");
    registerMemoryCommands(root);
    return root.commands as Command[];
  },
};

export default memoryModule;
