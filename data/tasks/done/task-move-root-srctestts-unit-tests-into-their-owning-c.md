---
id: task-move-root-srctestts-unit-tests-into-their-owning-c
title: Move root src/*.test.ts unit tests into their owning core/ and modules/ subsystems
status: done
priority: p2
area: architecture
summary: Relocate the clearly-subsystem-owned unit tests currently sitting at the src/ root into core/<area>/ or modules/<module>/ beside the code they exercise, then add a root-guard test so future unit tests cannot re-accumulate at src/*.test.ts.
created_at: 2026-04-24T11:01:01.824Z
updated_at: 2026-04-24T11:19:36.271Z
---

## Problem

`src/AGENTS.md` states `src/` has two layers (`src/core/` + `src/modules/`)
and that "Root `src/*.ts` files should stay rare and act only as public
entrypoints or thin repo-wide glue." The recent core-shrink thread closed
the last `#modules/*` imports inside `src/core/` and guarded both source
and test files against re-introducing them. What is still loose is the
`src/` root itself: roughly 25 plain unit tests (not `.integration.test.ts`,
not cross-subsystem end-to-end) live directly at `src/*.test.ts` even though
they exercise a single core or module subsystem. Examples:

- `src/cost.test.ts`, `src/loop.test.ts`, `src/message-pruning.test.ts`,
  `src/reflection.test.ts`, `src/session-state.test.ts`,
  `src/system-prompt.test.ts`, `src/transport.test.ts` — all import from
  `./core/loop/*`.
- `src/event-bus.test.ts` → `core/events/`, `src/file-tracker.test.ts` →
  `core/file-tracking/`, `src/approval-queue.test.ts` /
  `src/owner-question-queue.test.ts` → `core/daemon/`,
  `src/delegate-prompts.test.ts` → `core/agents/`, `src/config.test.ts` /
  `src/config-warnings.test.ts` → `core/config/`.
- `src/module-context.test.ts`, `src/module-deps.test.ts`,
  `src/module-discovery.test.ts`, `src/module-factory.test.ts`,
  `src/module-loader.test.ts`, `src/module-log.test.ts`,
  `src/module-storage.test.ts` — all target `core/modules/`.
- `src/composition.test.ts`, `src/workspace.test.ts` →
  `modules/composition/`; `src/secrets.test.ts` → `modules/secrets/`;
  `src/openai-model-client.test.ts` → `modules/model-clients/`.

These files violate the documented two-layer rule and there is no guard
preventing new ones from landing the same way. Contributors currently decide
by convention alone whether a new unit test belongs at `src/` root or under
its owning subsystem.

## Desired Outcome

The `src/` root contains only legitimate cross-cutting surfaces: the
entrypoint source files (`cli.ts`, `init.ts`, `module-api.ts`,
`validate-queue.ts`), the paired unit tests for those entrypoints
(`cli.test.ts`, `init.test.ts`), and cross-subsystem integration / e2e /
repo-wide tests (`*.integration.test.ts`, `e2e.test.ts`, `e2e-advanced.test.ts`,
`integration.test.ts`, `distributable-surfaces.test.ts`,
`docs-surface.test.ts`, `module-e2e.test.ts`). Every other unit test has
moved next to the code it exercises inside `core/<area>/` or
`modules/<module>/`. A repo-wide guard test enforces this going forward
so the two-layer rule is mechanical, not convention.

Concretely:

- Each relocated test updates its imports to the local path form used by
  neighboring tests in the destination directory (either relative
  `./file.js` or `#core/*` / `#modules/*` package imports, matching the
  surrounding style).
- The vitest run picks the moved tests up at their new location with no
  config changes; tests still pass.
- A new guard test (for example `src/root-layout.test.ts` or a check
  inside `src/distributable-surfaces.test.ts`) asserts that every
  `src/*.test.ts` file matches the allowed cross-cutting whitelist and
  fails loudly if a new non-whitelisted unit test lands at the root.
- `src/AGENTS.md` is updated to describe the enforced layout at the
  conventions level: what belongs at `src/` root, what belongs in
  `core/<area>/` or `modules/<module>/`, and the fact that the guard test
  enforces it.

## Constraints

- Only the clearly-owned unit tests move in this task. Cross-subsystem
  integration tests (`.integration.test.ts`, `e2e*`, `integration.test.ts`,
  `distributable-surfaces.test.ts`, `docs-surface.test.ts`,
  `module-e2e.test.ts`) stay at `src/` root because they legitimately span
  multiple subsystems.
- The paired entrypoint tests (`cli.test.ts`, `init.test.ts`) stay next
  to their source files at `src/` root.
- Do not silently soften a test when relocating it. If a moved test
  depends on relative path conventions that no longer resolve from the
  new location, fix the imports; do not weaken the assertions.
- The guard test must be specific: it should whitelist the known
  cross-cutting files explicitly and reject any new plain-unit pattern
  (`<topic>.test.ts`) at the `src/` root. A blanket "anything at root
  is fine" check would not enforce the rule.
- Do not add a compatibility shim, re-export, or aliased copy at the old
  location. The move is clean.
- Respect the surrounding import style at each destination. If
  neighboring tests use `#core/*` or `#modules/*` package imports, the
  relocated test should match.
- When a destination directory has its own `AGENTS.md`, re-read it
  before landing the test and adjust the `AGENTS.md` only if the
  relocation changes a load-bearing convention there.

## Done When

- Every clearly-owned unit test currently at `src/*.test.ts` has moved
  into `src/core/<area>/` or `src/modules/<module>/` beside the code it
  exercises; `git log --follow` on each moved file preserves history.
- `pnpm kota task move` has been run for this task at each state
  transition (ready → doing → done); the task frontmatter stays in sync
  with the directory.
- A guard test is present and fails if a new `src/*.test.ts` is added
  outside the whitelist of cross-cutting entries.
- The full vitest suite passes at the new layout; no test is silently
  skipped, renamed, or merged during the move.
- `src/AGENTS.md` describes the enforced layout and the role of the
  guard test at the conventions level.
- `src/` root `.ts` surface matches the new rule: entrypoint source
  files, their paired tests, and cross-cutting integration files only.
