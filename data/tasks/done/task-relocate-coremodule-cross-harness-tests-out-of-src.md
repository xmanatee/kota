---
id: task-relocate-coremodule-cross-harness-tests-out-of-src
title: Relocate core→module cross-harness tests out of src/core to purge core test-layer module imports
status: done
priority: p2
area: core
summary: Move the three cross-harness.test.ts files (and harness/module-coupled workflow/daemon/tool tests) out of src/core so src/core imports zero #modules/* adapters even in tests, matching the inverted protocol boundary enforced for non-test core code.
created_at: 2026-04-24T10:23:36.987Z
updated_at: 2026-04-24T10:40:14.651Z
---

## Problem

The multi-stage neutral-protocol audit and the recent module-inversion series
(rendering, history, execution, voice handlers, registry, delegate backend,
`KotaTool`/`KotaMessage`/`KotaModelResponse`) have driven `src/core/` to zero
`#modules/*` imports in non-test sources. The core agent-harness module
already enforces this at non-test scope via
`src/core/agent-harness/no-anthropic-imports-in-core.test.ts`.

The remaining violations are all in test files under `src/core/`:

- `src/core/agent-harness/hooks-cross-harness.test.ts`
- `src/core/repl/harness-repl.test.ts`
- `src/core/prompt-input/cross-harness.test.ts`

These three files intentionally import both `claudeAgentHarness` from
`#modules/claude-agent-harness/adapter.js` and `thinAgentHarness` from
`#modules/thin-agent-harness/adapter.js` to assert parity of core protocol
surfaces across both registered adapters. A second cluster of core tests
reaches into `#modules/claude-agent-harness/*` for `executeWithAgentSDK` and
`KOTA_OWNER_QUESTIONS_MCP_TOOL` defaults:

- `src/core/workflow/run-executor-parallel.test.ts`
- `src/core/workflow/runtime.test.ts`
- `src/core/workflow/validation.test.ts` (imports `#modules/autonomy`)
- `src/core/workflow/steps/step-executor.test.ts`
- `src/core/workflow/steps/step-executor-agent.test.ts`
- `src/core/daemon/daemon.test.ts`
- `src/core/tools/delegate.test.ts` (imports `#modules/prompt-templates`)
- `src/core/tools/tool-runner-integration.test.ts` (imports
  `#modules/tool-retry`)
- `src/core/tools/tool-runner.integration.test.ts` (imports
  `#modules/tool-retry`)
- `src/core/tools/tool-telemetry.test.ts` (imports `#modules/filesystem`)

The cross-harness parity tests are cross-module integration tests — by
construction they depend on at least two harness adapter modules and cannot
live in a layer forbidden from naming its modules. The workflow / daemon /
tool cluster imports module-owned helpers purely to obtain a "default" agent
SDK executor or a mock tool.

As long as these tests sit inside `src/core/`, no lint / import-guard can
promise "core has zero `#modules/*` imports" without an explicit test-file
exception list. That exception list exists today only by convention and
invites regressions: a new non-test file in `src/core/` that happens to
import from `#modules/*` would not trip a core-wide guard.

## Desired Outcome

- No file under `src/core/` imports from `#modules/*`, including test files.
- The cross-harness parity invariants the three `cross-harness.test.ts`
  files assert (hooks fire identically; harness-repl behaves identically;
  prompt-input expands identically) still have live test coverage after the
  move, in a location that is architecturally allowed to depend on multiple
  harness modules.
- The workflow / daemon / tool test cluster either (a) stops naming a
  specific harness module by using a neutral in-test `AgentHarness` double
  registered through `registerAgentHarness`, or (b) moves to the
  cross-cutting `src/*.integration.test.ts` tier where depending on
  `#modules/*` is expected.
- A core import-guard test extends the existing
  `no-anthropic-imports-in-core` pattern to also reject `#modules/*`
  imports from any file under `src/core/` (test or not), so future
  regressions fail at CI rather than at review.
- No behavior regressions: `pnpm test` still covers the same invariants
  (hooks parity, prompt-input parity, harness-repl parity, default-executor
  workflow / daemon smoke paths, tool-retry / tool-telemetry / delegate
  integration).

## Constraints

- Do not introduce a parallel test runner or a bespoke "cross-harness"
  harness — reuse the existing vitest setup and the existing
  `registerAgentHarness` registry.
- Do not weaken an existing parity assertion by mocking away one of the
  adapters. If a test asserts that both adapters fire the same hook, both
  adapters must still be exercised.
- Cross-harness parity tests should land under `src/` (alongside the
  existing `src/*.integration.test.ts` cross-cutting tier) or under a
  dedicated `src/modules/harness-parity/` sub-test location. Do not create
  a new top-level `tests/` directory — that would split the test surface.
- The import guard must reject both source and test files; per-file
  suppressions are not allowed.
- Keep a single pass. Do not leave a second cleanup task behind for the
  workflow / daemon / tool cluster; convert or move all remaining
  `#modules/*` imports under `src/core/` in the same change.
- Follow the workflow finish protocol in
  `src/modules/autonomy/workflows/AGENTS.md` — stage via `git add -A` and
  write `commit-message.txt`; do not run `git commit`.

## Done When

- `rg "from \"#modules/" src/core/` returns no results.
- A core-scope import-guard test fails if a file under `src/core/` (source
  or test) adds a `#modules/*` import.
- Hooks parity, harness-repl parity, and prompt-input parity remain covered
  by tests in a location that imports the relevant harness adapters
  directly.
- Default-executor smoke coverage for `workflow/run-executor-parallel`,
  `workflow/runtime`, `workflow/validation`, `workflow/steps/*`, and
  `daemon/daemon` either uses a neutral in-test `AgentHarness` or lives
  outside `src/core/`.
- Tool-layer integration tests that reach into `#modules/{tool-retry,
  filesystem, prompt-templates}` live outside `src/core/tools/` or rely on
  a neutral in-test double.
- `pnpm test` and `pnpm typecheck` pass.
