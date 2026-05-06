---
id: task-drop-config-operations-as-unknown-self-casts-via-t
title: Drop config-operations as-unknown self-casts via typed dot-path traversal helper
status: done
priority: p2
area: modules
summary: Replace the three as-unknown-as-Record self-casts in src/modules/config/config-operations.ts with a typed dot-path traversal helper so the production file no longer self-casts loaded KotaConfig values to arbitrary records.
created_at: 2026-05-06T09:55:42.465Z
updated_at: 2026-05-06T10:02:25.013Z
---

## Problem

`src/modules/config/config-operations.ts` carries three internal
`as unknown as Record<string, unknown>` self-casts that exist purely so
the dot-notation lookup in `getConfigValue` and the dot-notation mutate
in `setConfigValue` can traverse a typed `KotaConfig`:

- line 63 — `resolved: resolved as unknown as Record<string, unknown>`
  on the `validateConfig` result.
- line 68 — `const resolved = loadConfig(projectDir) as unknown as
  Record<string, unknown>` at the top of `getConfigValue`.
- line 102 — `const existing = (raw as unknown as Record<string,
  unknown>)[parts[0]]` inside the `updateProjectConfig` callback.

Each of these forces the production file to launder the typed config
through `unknown` to widen it. The strict-types-policy baseline counts
this file at 11 (`src/strict-types-policy-baseline.json`); the three
internal self-casts are the offending lines that make the file feel
permissively typed even though the surrounding code already validates
shapes at the JSON-parse boundary.

Recent landed cadence — `tighten core/tools/tool-adapters.ts format
detection` (9618773c), `drop the runtime-dispatch placeholder Promise
self-cast` (3b7339f2), `drop as-unknown self-cast at the module
event-proxy boundary` (26b97de6) — is exactly this shape: remove
internal self-casts by introducing a typed seam, leaving only the
external-input boundary cast (if any) inside that seam.

## Desired Outcome

A typed dot-path traversal seam owns the single boundary cast for
`KotaConfig` → record-keyed view, and the three production call sites
in `config-operations.ts` use it without any `as unknown as` of their
own. Concrete acceptable shape:

- A small helper such as `getConfigPath(config: KotaConfig, parts:
  readonly string[]): { found: false; reason: "not_found" } | { found:
  true; value: unknown }` that owns the `Record<string, unknown>`
  traversal internally.
- A small helper such as `setConfigPath(draft: KotaConfig, parts:
  readonly [string, ...string[]], value: unknown): KotaConfig` that
  owns the typed-mutation pattern used inside the
  `updateProjectConfig` callback.
- `validateConfig` returns the resolved config without `as unknown
  as`. If `ConfigValidateResult` exposes the resolved view to clients
  as `Record<string, unknown>`, the conversion happens inside one
  named helper so the cast appears once and explains itself, not three
  times across three functions.

## Constraints

- Keep the public behavior of `validateConfig`, `getConfigValue`, and
  `setConfigValue` identical. Existing tests in
  `src/modules/config/*.test.ts` and the daemon control-route tests
  must keep passing without edits to assertions.
- Do not change the public shape of `ConfigGetResult` /
  `ConfigSetResult` / `ConfigValidateResult` unless the new helpers
  make a stricter shape obviously correct.
- The `Record<string, unknown>` view of `KotaConfig` is acceptable
  only inside the new helper(s), as a single boundary cast. The
  three call sites in `config-operations.ts` must not contain `as
  unknown as` themselves.
- No new `as unknown as` anywhere else in the file or in the helper
  module beyond the single boundary cast inside the helper. The
  baseline count for `src/modules/config/config-operations.ts` must
  drop by exactly the number of self-casts removed (3) and the
  baseline JSON must be regenerated alongside the change.
- The helper(s) live next to `config-operations.ts` (same module),
  since this is a `src/modules/config/` concern; do not promote it
  into `src/core/`.
- Do not alter the JSON-parse error-tolerance shape in `readRawKeys`;
  that is the existing external-input boundary and is out of scope.

## Done When

- `grep "as unknown as" src/modules/config/config-operations.ts`
  returns zero matches.
- The new helper module compiles and is unit-tested for: missing
  intermediate key returns `not_found`, leaf hit returns the value at
  any nesting depth supported today, single-segment set replaces the
  top-level entry, two-segment set merges into the existing nested
  object, two-segment set when the existing top-level is absent or
  non-object creates a fresh nested object.
- `pnpm typecheck`, `pnpm lint`, and the existing config-operations
  test files pass without touching assertions in unrelated tests.
- `src/strict-types-policy-baseline.json` is regenerated and the
  count for `src/modules/config/config-operations.ts` drops by 3.
- The strict-types-policy ratchet test
  (`src/strict-types-policy.integration.test.ts`) passes.

## Source / Intent

Strategic-area refactor cadence (`area: modules`): the explorer has
been queueing one targeted typed-protocol refactor per cycle, and the
builder has been landing them. This task is the next obvious link in
that chain — the three remaining `as unknown as Record` self-casts in
`config-operations.ts` are exactly the pattern recently landed for
`tool-adapters.ts`, `runtime-dispatch.ts`, `module-event-proxy`,
`AgentLoopState`, and `NotificationGate`. Removing them keeps the
strict-by-default invariant honest at the config-CLI boundary.

## Initiative

Strict-by-default typed protocols across `src/modules/`: each module
should consume typed shapes without internal self-casts, with any
`Record<string, unknown>` view confined to a single named boundary
helper. This task advances that initiative by retiring three of the
internal self-casts the strict-types-policy baseline is currently
ratcheting on.

## Acceptance Evidence

- Diff against `src/modules/config/config-operations.ts` shows the
  three self-cast lines (63, 68, 102) replaced by typed-helper calls.
- New helper file diff shows the boundary cast in one named place,
  with co-located unit tests covering missing-segment, leaf-hit,
  top-level set, and nested-merge set.
- `src/strict-types-policy-baseline.json` diff shows the
  `config-operations.ts` count dropping by 3.
- `pnpm typecheck`, `pnpm lint`, and the strict-types-policy
  integration test all green in the run artifact log.
