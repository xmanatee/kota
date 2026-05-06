---
id: task-tighten-coretoolstool-adaptersts-format-detection-
title: Tighten core/tools/tool-adapters.ts format detection so external-tool adaptation drops as-unknown-as self-casts
status: done
priority: p2
area: core
summary: Replace boolean format predicates and as-unknown-as casts in core/tools/tool-adapters.ts with a single typed format-detection that returns a discriminated union, so external-tool adaptation no longer threads casts through every branch.
created_at: 2026-05-06T09:21:13.766Z
updated_at: 2026-05-06T09:36:33.406Z
---

## Problem

`src/core/tools/tool-adapters.ts` is the highest-count non-testing pin
in `src/strict-types-policy-baseline.json` (23). The cost is real, not
cosmetic: every external-tool format branch in `adaptExport` and
`adaptToolArray` threads a separate `as unknown as OpenAIFunctionTool`,
`as unknown as SimpleTool`, `as unknown as VercelAITool`, or
`as KotaModule` cast at the call site, because the format-detection
helpers (`isOpenAIFormat`, `isSimpleFormat`, `isVercelAIFormat`,
`isKotaModule`) all return plain `boolean` over a
`Record<string, unknown>` input. The boundary that *should* be a single
"is this a known external tool format and which one is it" parse is
instead five sites that each redundantly assert the same shape, with
no compiler help when a new format is added or the predicate drifts
from the constructor it gates.

## Desired Outcome

`adaptExport` (and the per-item path in `adaptToolArray`) call one
typed format-detection helper that returns a discriminated union over
the recognized external-tool formats, e.g.

```
type DetectedFormat =
  | { kind: "kota-module"; value: KotaModuleLike }
  | { kind: "openai"; value: OpenAIFunctionTool }
  | { kind: "simple"; value: SimpleTool }
  | { kind: "vercel-ai"; value: VercelAITool }
  | { kind: "vercel-ai-map"; entries: Array<[string, VercelAITool]> }
  | null;
```

The detection helper performs the shape narrowing once at the boundary
and returns the value already typed, so adapter call sites
(`fromOpenAI`, `fromSimple`, `fromVercelAI`, the pass-through KotaModule
branch, and the per-item adaptToolArray path) consume typed values
without `as unknown as` self-casts. The surrounding `Record<string,
unknown>` view of `exported` stays at the actual external-input edge
where it belongs (per `AGENTS.md` "Validate at the edge").

## Constraints

- The detection helper lives next to the existing adapters
  (`src/core/tools/tool-adapters.ts` or a new sibling), not in a
  separate module. No second public surface for tool adaptation.
- The behavior of `adaptExport` and `adaptToolArray` must not change
  for any currently-recognized export shape. Existing tests in
  `src/core/tools/` and any callers in `src/modules/` must pass
  unchanged. New tests cover the detection helper directly so a future
  format addition has a single place to register.
- `Record<string, unknown>` and `unknown` are still appropriate at the
  external-input boundary. The goal is to drop *internal* casts that
  re-assert shape after a predicate has already checked it, not to
  pretend the external input was strongly typed all along.
- Detection predicates that previously returned `true` for incomplete
  shapes (e.g. `isOpenAIFormat` only checks `type === "function"` and
  that `function` is an object) keep their lenient contract — the
  detailed validation lives in the constructors (`fromOpenAI`,
  `fromSimple`, `fromVercelAI`) and continues to throw with the same
  error messages on malformed input.
- The strict-types-policy ratchet is the success metric:
  `src/strict-types-policy-baseline.json` for
  `src/core/tools/tool-adapters.ts` drops materially from 23 toward
  the count that actually remains at the external-input boundary
  after the refactor. Update the baseline in the same commit.

## Done When

- A single `detectExportFormat(...)` (or equivalent) helper returns a
  discriminated union over recognized external-tool formats, with each
  branch carrying a typed `value` (or typed entries for the
  vercel-ai-map case). Every detection branch in `adaptExport` and
  `adaptToolArray` consumes that union instead of re-doing predicate
  + cast.
- `as unknown as OpenAIFunctionTool`, `as unknown as SimpleTool`, and
  `as unknown as VercelAITool` no longer appear in
  `src/core/tools/tool-adapters.ts`. The `as KotaModule` casts on the
  pass-through branch are similarly replaced by typed return from
  detection (or narrowed with a real type guard if pass-through must
  still be expressed inline).
- `src/strict-types-policy-baseline.json` is updated in the same
  commit so the ratchet test passes; the
  `src/core/tools/tool-adapters.ts` entry drops to the post-refactor
  count.
- Existing adapter behavior tests still pass; a new focused unit test
  covers `detectExportFormat` directly across all five recognized
  shapes plus the unrecognized-input null branch.

## Source / Intent

Continuation of the recent strict-types ratchet cadence (runtime-
dispatch placeholder Promise self-cast, NotificationGate emit-
middleware, ModuleEventProxy self-cast, AgentLoopState self-casts,
DaemonSseEvent typed-union tighten). With those landed,
`tool-adapters.ts` is the highest-count non-testing pin in the
baseline and the most concentrated remaining example of the same
pattern: a typed-protocol boundary expressed as predicate-plus-cast
instead of as a typed parse. Tightening it continues the
core-shrinking trajectory the queue rules call out and converts a
recurring pattern hazard into an explicit, single-site format
boundary.

## Initiative

Strict-types ratchet at typed-protocol boundaries: each remaining
high-count pin in `src/strict-types-policy-baseline.json` is converted
from "predicate plus self-cast" into "typed parse at the edge", so
internal call sites stop re-asserting shape and the baseline shrinks
toward the irreducible external-input surface.

## Acceptance Evidence

- `pnpm test src/strict-types-policy.integration.test.ts` (or the
  equivalent path) passes with the updated baseline showing a
  materially lower count for `src/core/tools/tool-adapters.ts`.
- `git grep "as unknown as \(OpenAIFunctionTool\|SimpleTool\|VercelAITool\)" src/core/tools/tool-adapters.ts` returns no matches.
- A new focused test (e.g. `tool-adapters.test.ts` or sibling) exercises
  `detectExportFormat` directly across all five recognized shapes plus
  unrecognized input, asserting both the discriminator and the
  narrowed `value` type usage compiles without casts.
