---
id: task-eliminate-remaining-core-to-execution-module-impor
title: Eliminate remaining core to execution-module imports
status: ready
priority: p2
area: architecture
summary: Remove #modules/execution imports from core/ by moving custom-tool and manifest code-execution out of core; core must not depend on any module at runtime.
created_at: 2026-04-24T08:06:39.554Z
updated_at: 2026-04-24T08:06:39.554Z
---

## Problem

After the recent "REPL-session and code-wrappers out of core" landing,
`src/modules/execution/` now owns the language-REPL sessions and the shared
code-wrapper constants. But core still reaches back into the execution module
through production imports:

- `src/core/tools/custom-tool.ts` imports `DEFAULT_TIMEOUT` from
  `#modules/execution/code-wrappers.js`.
- `src/core/tools/custom-tool-handlers.ts` imports `DEFAULT_TIMEOUT`,
  `MAX_OUTPUT`, and `sessions` from the execution module.
- `src/core/tools/custom-tool-persistence.ts` imports `type Language` from
  `#modules/execution/repl-session.js`.
- `src/core/manifest/types.ts` and `src/core/manifest/execution.ts` import
  `Language`, `sessions`, `DEFAULT_TIMEOUT`, and `MAX_OUTPUT` from the
  execution module.

These imports make `src/modules/execution/` a hard runtime dependency of core.
Any deployment that disables or swaps the execution module breaks core tool
registration and manifest-driven module loading. The repo-wide direction in
`src/core/AGENTS.md` is the opposite: core defines the protocol, modules plug
in. The import-guard pattern used for `@anthropic-ai/sdk` (Stage 6 audit)
proves we can enforce this invariant mechanically once it holds.

## Desired Outcome

No `src/core/**/*.ts` file imports from `#modules/execution/**` in production
code. The core tool runtime keeps the `custom_tool` capability available and
the manifest subsystem keeps compiling agent-authored modules to `KotaModule`
objects, but code-execution specifics (language sessions, wrapper timeouts,
output caps, wrapper construction) live behind a core-owned protocol that
execution (or any future executor module) implements. A focused import-guard
test mirrors `no-anthropic-imports-in-core.test.ts` and fails the suite if a
future change reintroduces a `#modules/execution` import under `src/core/`.

## Constraints

- Do not delete or narrow the operator-facing surface. `custom_tool` must stay
  a registered core tool; `manifestToModule()` must keep turning manifests into
  `KotaModule` instances the module loader accepts.
- Pick one mechanism. Either (a) move the affected core-hosted code into the
  execution module and contribute it back as a module-owned tool plus
  module-owned manifest-compiler extension, or (b) introduce a core-neutral
  "code runner" protocol in `src/core/` that the execution module fills. Do
  not ship both. Record the decision in the run directory.
- Keep the `core/AGENTS.md` boundary rules intact: if the chosen approach
  leaves a declarative manifest-parser primitive in core, it parses/validates
  only and does not compile runners itself.
- No parallel registries, no hidden fallbacks, and no "execution-is-the-only-
  executor" assumptions. The registration path must tolerate zero registered
  executors (custom-tool loading becomes a no-op with a clear loud error at
  tool-invocation time).
- Respect the existing circular-dependency workaround in
  `core/tools/custom-tool.ts` (the `initCustomToolRegistry` injection seam).
- Tests that currently exercise custom-tool or manifest-driven module loading
  must continue to pass without adding test-only production flags or hooks.

## Done When

- `src/core/**/*.ts` has zero production imports from `#modules/execution/**`.
  The existing tests under `src/core/` continue to pass without reintroducing
  such imports.
- A new import-guard test under `src/core/` walks `src/core/**/*.ts` and fails
  the suite if a future change adds a `#modules/execution` import (matching
  the Stage 6 Anthropic-SDK guard pattern).
- `src/core/AGENTS.md` (or the affected subtree `AGENTS.md` files) records the
  new boundary in one or two sentences so the rule is discoverable without
  reading the audit history.
- Operator-facing behavior — `custom_tool` creation/removal/persistence and
  manifest-driven module loading — is unchanged end-to-end against the
  existing tests. No test-only flags or guards were added.
- If the chosen approach introduces a new protocol surface (approach b), its
  contract, registration shape, and zero-executor fallback are documented in
  the owning subtree's `AGENTS.md` at the conventions level.
