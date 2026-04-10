import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const SRC_ROOT = fileURLToPath(new URL("./src", import.meta.url));
const SRC_CORE = fileURLToPath(new URL("./src/core", import.meta.url));
const SRC_MODULES = fileURLToPath(new URL("./src/modules", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "#root": SRC_ROOT,
      "#core": SRC_CORE,
      "#modules": SRC_MODULES,
    },
    conditions: ["source"],
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Many tests spawn subprocesses (Python REPL, CLI binary, MCP servers).
    // Capping at 4 prevents resource starvation under full parallel load.
    maxForks: 4,
    // Tests and hooks that run real git/subprocess ops need more than the 5s/10s defaults.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
