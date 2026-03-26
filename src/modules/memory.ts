/**
 * Memory module — persistent memory across sessions.
 *
 * First built-in module extracted using the KotaExtension protocol.
 * Registers the `memory` tool in the `management` group.
 */

import type { KotaExtension } from "../extension-types.js";
import { memoryTool, runMemory } from "../tools/memory.js";

const memoryModule: KotaExtension = {
  name: "memory",
  version: "1.0.0",
  description: "Persistent memory across sessions (save/search/list/update/delete)",
  tools: [
    {
      tool: memoryTool,
      runner: runMemory,
      group: "management",
    },
  ],
  promptSection: () =>
    "Persistent key-value memory across sessions. " +
    "Save user preferences, project conventions, and key decisions proactively. " +
    "Search before saving to avoid duplicates. " +
    "Use tags for categorization (e.g. preference, project, decision).",
};

export default memoryModule;
