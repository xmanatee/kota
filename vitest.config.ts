import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Many tests spawn subprocesses (Python REPL, CLI binary, MCP servers).
    // Capping at 8 prevents resource starvation under full parallel load.
    maxForks: 8,
  },
});
