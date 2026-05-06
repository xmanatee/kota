---
id: task-drop-config-sanitize-as-unknown-self-casts-by-typi
title: Drop config-sanitize as-unknown self-casts by typing raw config input as unknown
status: done
priority: p2
area: core
summary: Type sanitize/sanitizeCore inputs as unknown so the JSON-parse boundary owns the single Record<string, unknown> view of raw config and the per-section sanitizers stop self-casting back to Record<string, unknown> on every field.
created_at: 2026-05-06T10:30:15.724Z
updated_at: 2026-05-06T10:39:27.528Z
---

## Problem

`src/core/config/config-sanitize.ts` carries 13+ internal `as
Record<string, unknown>` self-casts that exist only because the
function signatures lie about their input. `sanitizeCore(raw:
Partial<KotaConfig>)` and `sanitize(raw: Partial<KotaConfig>)` both
accept `Partial<KotaConfig>`, but every caller (`config.ts:181-183`)
hands them values pre-cast from JSON-parsed `unknown` —
`readConfigFile` does the lying cast at `config.ts:161`
(`return parsed as Partial<KotaConfig>`). Because the input is typed
as a structured `Partial<KotaConfig>`, every field-by-field narrowing
inside the sanitizer (`raw.runsGc`, `raw.modelTiers`, `raw.log`,
`raw.guardrails`, `raw.modules`, plus the per-section helpers
`sanitizeServe` / `sanitizeCli` / `sanitizeDaemon` /
`sanitizeNotifications` / `sanitizeWorkflow` /
`sanitizeModuleMonitoring` / `sanitizeForeignModules`) has to launder
the typed shape back through `Record<string, unknown>` to read its
keys with `typeof` checks. The result is the second-highest-count
production pin in `src/strict-types-policy-baseline.json` (20), and
the casts are self-defeating: they re-widen a shape the function
itself is supposed to narrow.

The recent landed cadence — `tighten core/tools/tool-adapters.ts
format detection` (9618773c), `drop the runtime-dispatch placeholder
Promise self-cast` (3b7339f2), `drop as-unknown self-cast at the
module event-proxy boundary` (26b97de6), `drop config-operations.ts
as-unknown self-casts via typed dot-path traversal helper` (a6f55bf3)
— is exactly this shape: stop pretending an external-input value was
strongly typed, own the boundary cast in one named place, and let
the rest of the file consume narrowed values without casts.

## Desired Outcome

`sanitize` and `sanitizeCore` accept genuinely-untyped JSON input,
and the per-section sanitizers consume already-narrowed
`Record<string, unknown>` views without re-casting. Concrete acceptable
shape:

- `sanitize(raw: unknown): Partial<KotaConfig>` and `sanitizeCore(raw:
  unknown): Partial<CoreKotaConfig>`. The function bodies start with a
  single `isPlainObject(raw)` guard (the type guard already exported
  from this file) and return an empty result when the input is not an
  object.
- After the top-level guard, each field access (`raw.runsGc`,
  `raw.modelTiers`, `raw.log`, ...) is `unknown` by construction;
  `isPlainObject(raw.runsGc)` narrows it to `Record<string, unknown>`
  cleanly without any subsequent `as Record<string, unknown>`.
- Per-section helpers (`sanitizeServe`, `sanitizeCli`, etc.) accept
  `src: unknown` and apply the same `isPlainObject` guard at entry.
  No helper takes `KotaConfig["X"]` as input only to immediately cast
  away from it.
- `readConfigFile` returns `unknown` (or a narrowed
  `Record<string, unknown> | null`) and the call sites in `loadConfig`
  hand the untyped value directly to `sanitize`. The lying
  `parsed as Partial<KotaConfig>` cast at `config.ts:161` disappears.
- The `Record<string, unknown>` view stays where it belongs: as a
  field type for module-slice accumulators (the line declaring
  `Record<string, Record<string, unknown>>` for the modules slice)
  and inside the slice-walk in `sanitize`, where the
  `(raw as Record<string, unknown>)[slice.key]` access is replaced by
  reading `raw[slice.key]` against the already-narrowed top-level
  shape.

## Constraints

- Public behavior of `sanitize`, `sanitizeCore`, `loadConfig`, and
  `readConfigFile` must not change. Existing tests in
  `src/core/config/*.test.ts` must keep passing without assertion
  edits.
- `isPlainObject` stays a type guard; do not duplicate the guard
  logic across the file. The single existing type guard at line 138
  is the narrowing seam.
- `Record<string, unknown>` and `unknown` are still appropriate at
  the external-input boundary (raw JSON parse result, slice
  accumulator). The goal is to drop *internal* casts that re-assert
  shape after the type guard has already narrowed it, not to pretend
  arbitrary JSON was strongly typed.
- The strict-types-policy ratchet is the success metric:
  `src/strict-types-policy-baseline.json` for
  `src/core/config/config-sanitize.ts` drops materially from 20 toward
  the count that legitimately remains at the
  module-slice-accumulator boundary. Update the baseline in the same
  commit.
- No new helper module. The narrowing happens through the existing
  `isPlainObject` guard in this file; the only structural change is
  the input type and the corresponding shape of the per-section
  helpers.

## Done When

- `sanitize(raw: unknown): Partial<KotaConfig>` and
  `sanitizeCore(raw: unknown): Partial<CoreKotaConfig>` accept
  untyped input and start with a single `isPlainObject` guard.
- `git grep "as Record<string, unknown>" src/core/config/config-sanitize.ts`
  returns at most one or two matches, only at the
  module-slice-accumulator boundary that genuinely needs the cast.
- `readConfigFile` no longer casts JSON-parsed `unknown` to
  `Partial<KotaConfig>`; its return type reflects the truth and
  `loadConfig` hands the value to `sanitize` without re-casting.
- `src/strict-types-policy-baseline.json` is updated in the same
  commit so the ratchet test passes; the
  `src/core/config/config-sanitize.ts` entry drops to the
  post-refactor count, and any downstream entries that change
  (notably `src/core/config/config.ts` if `readConfigFile` retypes)
  are updated alongside.
- Existing config tests in `src/core/config/*.test.ts` and
  daemon/control-route tests that rely on `loadConfig` keep passing
  without edits to assertions.

## Source / Intent

Continuation of the strict-types ratchet thread the explorer has been
queuing one file at a time. With `tool-adapters.ts`, `runtime-
dispatch.ts`, `module-event-proxy`, `config-operations.ts`, and the
recent NotificationGate / AgentLoopState / DaemonSseEvent landings,
`config-sanitize.ts` is now the highest-count non-testing pin in
`src/strict-types-policy-baseline.json` whose self-casts are an
artifact of a lying input type rather than an inherent
external-data-shape problem. Tightening it converts the recurring
"input typed as `Partial<KotaConfig>`, then re-cast to `Record<string,
unknown>` everywhere" pattern into a single honest boundary, exactly
the core-shrinking cadence the queue rules call out.

## Initiative

Strict-types ratchet at typed-protocol boundaries: each remaining
high-count pin in `src/strict-types-policy-baseline.json` is converted
from "predicate plus self-cast" or "mistyped input plus per-field
re-cast" into "typed parse at the edge", so internal call sites stop
re-asserting shape and the baseline shrinks toward the irreducible
external-input surface.

## Acceptance Evidence

- `pnpm test src/strict-types-policy.integration.test.ts` passes
  with the updated baseline showing a materially lower count for
  `src/core/config/config-sanitize.ts` (from 20 toward the irreducible
  module-slice-accumulator residue).
- `git grep "as Record<string, unknown>" src/core/config/config-sanitize.ts`
  returns at most one or two matches, all at the module-slice
  accumulator boundary.
- `git grep "as Partial<KotaConfig>" src/core/config/config.ts`
  returns no matches inside `readConfigFile`.
- Existing `src/core/config/*.test.ts` suite passes unchanged
  (`pnpm test src/core/config/`).
