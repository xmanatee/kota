import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const SRC_ROOT = fileURLToPath(new URL("./src", import.meta.url));
const SRC_CORE = fileURLToPath(new URL("./src/core", import.meta.url));
const SRC_MODULES = fileURLToPath(new URL("./src/modules", import.meta.url));
const CLI_TEST_FILES = [
  "src/cli.test.ts",
  "src/module-cli-commands.integration.test.ts",
];
const EVAL_TEST_FILES = "src/modules/eval-harness/**/*.test.ts";
const INTEGRATION_TEST_FILES = "src/**/*.integration.test.ts";
const PROTOCOL_TEST_FILES = [
  "src/core/agent-harness/neutral-protocol-shape.test.ts",
  "src/core/mcp/client-http-redirect-policy.test.ts",
  "src/core/mcp/client-oauth-endpoint-policy.test.ts",
  "src/core/mcp/client-oauth-redirect-policy.test.ts",
  "src/core/mcp/stdio-stderr-redaction.test.ts",
  "src/core/mcp/client.test.ts",
  "src/modules/agent-client-protocol/**/*.test.ts",
  "src/modules/mcp-server/mcp-protocol-types.test.ts",
  "src/modules/mcp-server/interoperability.test.ts",
  "src/modules/mcp-server/server-card.test.ts",
  "src/modules/mcp-server/server.test.ts",
  "src/modules/mcp-server/streamable-http.test.ts",
];
const RESILIENCE_TEST_FILES = [
  "src/core/modules/foreign-module-resilient.test.ts",
  "src/module-error-resilience.integration.test.ts",
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
const OWNER_PROJECT_EXCLUDES = [
  ...TEST_EXCLUDES,
  ...CLI_TEST_FILES,
  EVAL_TEST_FILES,
  INTEGRATION_TEST_FILES,
  ...PROTOCOL_TEST_FILES,
  ...RESILIENCE_TEST_FILES,
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
    include: [],
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
    ],
    // Source-CLI tests each launch several TSX subprocesses. Run them after
    // the process-heavy main suite so worker saturation cannot consume their
    // bounded child-process timeout.
    projects: [
      {
        extends: true,
        test: {
          name: "owner",
          include: ["src/**/*.test.ts"],
          exclude: OWNER_PROJECT_EXCLUDES,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "protocol",
          include: PROTOCOL_TEST_FILES,
          exclude: TEST_EXCLUDES,
          maxWorkers: 2,
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: "resilience",
          include: RESILIENCE_TEST_FILES,
          exclude: TEST_EXCLUDES,
          maxWorkers: 2,
          sequence: { groupOrder: 2 },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: [INTEGRATION_TEST_FILES],
          exclude: [
            ...TEST_EXCLUDES,
            EVAL_TEST_FILES,
            ...CLI_TEST_FILES,
            ...RESILIENCE_TEST_FILES,
          ],
          maxWorkers: 2,
          sequence: { groupOrder: 3 },
        },
      },
      {
        extends: true,
        test: {
          name: "eval",
          include: [EVAL_TEST_FILES],
          exclude: TEST_EXCLUDES,
          maxWorkers: 2,
          sequence: { groupOrder: 4 },
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
          sequence: { groupOrder: 5 },
        },
      },
    ],
  },
});
