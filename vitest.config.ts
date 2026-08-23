import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const SRC_ROOT = fileURLToPath(new URL("./src", import.meta.url));
const SRC_CORE = fileURLToPath(new URL("./src/core", import.meta.url));
const SRC_MODULES = fileURLToPath(new URL("./src/modules", import.meta.url));
const CLI_TEST_FILES = [
  "src/cli.test.ts",
  "src/module-cli-commands.integration.test.ts",
];
const TEST_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
  "src/modules/eval-harness/fixtures/**/initial/**",
];
const CLI_PROJECT_EXCLUDES = [
  ...TEST_EXCLUDES,
  "src/core/**/*.test.ts",
  "src/modules/**/*.test.ts",
  "src/!(cli|module-cli-commands.integration).test.ts",
];

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
    // Eval-harness fixture `initial/` trees are verbatim snapshots of repo
    // source (pulled via `git show <commit>^:<path>` by the recorder). They
    // are not part of the KOTA codebase; running them as tests picks up
    // stale imports and violates architecture contracts.
    exclude: TEST_EXCLUDES,
    // Many tests spawn subprocesses (Python REPL, CLI binary, MCP servers).
    // Capping at 4 prevents resource starvation under full parallel load.
    maxWorkers: 4,
    // Tests and hooks that run real git/subprocess ops need more than the 5s/10s defaults.
    testTimeout: 60000,
    hookTimeout: 60000,
    setupFiles: [
      "./test/scope-authority-token.ts",
      "./test/loopback-fetch.ts",
    ],
    // Source-CLI tests each launch several TSX subprocesses. Run them after
    // the process-heavy main suite so worker saturation cannot consume their
    // bounded child-process timeout.
    projects: [
      {
        extends: true,
        test: {
          name: "main",
          exclude: [...TEST_EXCLUDES, ...CLI_TEST_FILES],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "cli",
          include: CLI_TEST_FILES,
          // Explicit exclusions keep positional file filters from making this
          // project rerun unrelated focused tests.
          exclude: CLI_PROJECT_EXCLUDES,
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
