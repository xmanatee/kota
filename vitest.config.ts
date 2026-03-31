import { defineConfig } from "vitest/config";

export default defineConfig({
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
