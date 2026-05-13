---
id: task-replace-workflow-agent-step-model-allowlist-with-p
title: Replace workflow agent step model allowlist with preset-derived validation
status: done
priority: p1
area: core
summary: Replace VALID_MODEL_IDS allowlist in validate-agent-step.ts with a preset/harness-derived predicate so codex/gemini workflow agent steps validate cleanly.
created_at: 2026-05-07T23:32:29.217Z
updated_at: 2026-05-07T23:52:27.853Z
---

## Problem

`src/core/workflow/step-validators/validate-agent-step.ts:31-35` ships a
hardcoded allowlist:

```ts
export const VALID_MODEL_IDS = new Set([
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
]);
```

Used at line 168, the validator rejects every non-Claude model at workflow
definition time, regardless of which harness is active. Until this is
replaced, every shipped workflow that names a codex- or gemini-shaped model
fails validation with `unknown model "..."` before it can run. This is the
smallest, most blocking item in the harness-portability initiative — it can
land independently of the broader preset abstraction by accepting any
non-empty model id and letting the per-harness wire layer reject.

The same file resolves the step's `harness` (lines 204-215), so the harness
is known at the moment we validate the model — the allowlist ignores it.

## Desired Outcome

Workflow agent step validation accepts any model the active preset (or
resolved harness) declares legal. No central allowlist of literal model ids
in core. Workflow agent step accepts a `tier: ModelTier` field as an
alternative to `model: string`; tier-shaped declarations survive a preset
swap without an edit.

## Constraints

- Strict by default: the new `tier` field cannot coexist with the `model`
  field on the same step. Discriminated union (`{ tier } | { model }`),
  not optional fields admitting illegal combinations. Throw on both or
  neither.
- No legacy: do not keep `VALID_MODEL_IDS` "for backwards compat".
  Existing workflows either pass through a string (accepted) or migrate
  to `tier` (preferred).
- The `effort` allowlist (`VALID_EFFORT_LEVELS` at the same file:36-42) is
  correct as-is — `AgentEffort` is genuinely a closed enum on the neutral
  protocol surface. Do not touch it.
- Per `AGENTS.md` strict-by-default: validate at the system boundary
  (workflow definition load), trust internal types after.

## Done When

- `VALID_MODEL_IDS` is deleted from core, or scoped to one shipped preset's
  catalog as a soft hint — never as an enforcement set.
- `validate-agent-step.ts` resolves the step's harness and asks it to
  validate the declared model. Most adapters accept any non-empty string
  and let the wire layer reject (matches what codex and gemini already do).
  Adapters that *do* know their catalog (e.g. claude-agent-sdk) opt in by
  exposing a `validateModelId(modelId): void` method on the harness
  contract. If absent, no central rejection.
- Workflow agent step accepts `tier: ModelTier` as an alternative to
  `model: string`. When `tier` is set, the resolver reads
  `preset.tiers[tier]` at run-construction time.
- Existing workflows that hardcode `model: "claude-opus-4-7"` either
  migrate to `tier: "capable"` (preferred) or keep their literal, but no
  longer fail validation under codex/gemini.
- The autonomy fleet workflow defs and any in-tree workflow agent steps
  migrate to tier names in the same change.
- Tests:
  - `src/workflow-validation.integration.test.ts` (or sibling) covers the
    new `tier` field, the dropped allowlist, and the per-harness opt-in
    `validateModelId` rejection path.
  - A regression test asserts that a step declaring
    `harness: "codex", model: "gpt-5.5"` validates cleanly when the codex
    adapter is registered.
  - A regression test asserts that a step declaring
    `harness: "gemini", model: "gemini-2.5-pro"` validates cleanly when
    the gemini adapter is registered.

## Source / Intent

Owner intent (verbatim, from inbox capture 2026-05-07):

> Operator wants to migrate from claude to codex/gemini for autonomy and
> workflow steps. A single hardcoded allowlist in
> `src/core/workflow/step-validators/validate-agent-step.ts` rejects every
> non-Claude model at workflow definition time, regardless of which
> harness is active.

Tracked separately from the broader preset abstraction (sibling task
`task-introduce-harness-preset-abstraction`) because it is fixable
independently — set `tier` to literal and drop the allowlist; preset-aware
tier resolution lands once the parent preset task does. This is the
single most concrete blocker to migrating any workflow agent step off
claude.

## Initiative

Harness-preset migration so KOTA can run autonomy and workflow steps
under codex / gemini / vercel without per-call-site edits. This task is
the smallest blocking item in that initiative; siblings:
`task-introduce-harness-preset-abstraction`,
`task-eradicate-hardcoded-claude-model-defaults`,
`task-add-cross-preset-runtime-parity-gate`.

## Acceptance Evidence

- Green run of `pnpm test workflow-validation` and any harness-parity
  test that exercises agent steps under non-claude harnesses,
  transcript captured under `.kota/runs/<run-id>/transcript.txt`.
- Diff that:
  - Deletes `VALID_MODEL_IDS` from `validate-agent-step.ts`.
  - Adds the optional `validateModelId` method to the `AgentHarness`
    contract in `src/core/agent-harness/types.ts`.
  - Adds `tier` resolution to the agent step input shape and runtime
    dispatch as a discriminated union with `model`.
  - Migrates in-tree workflow agent step definitions to use `tier` where
    appropriate (autonomy `AgentDef` entries, any builder/explorer/
    improver workflow steps that hardcode a literal model).
