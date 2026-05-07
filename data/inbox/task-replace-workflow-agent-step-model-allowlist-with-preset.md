---
title: Replace VALID_MODEL_IDS allowlist in validate-agent-step.ts with a preset-derived predicate so workflow agent steps work under codex/gemini
created_at: 2026-05-07T00:00:00.000Z
source: owner
---

Owner intent:

Operator wants to migrate from claude to codex/gemini for autonomy and
workflow steps. A single hardcoded allowlist in
`src/core/workflow/step-validators/validate-agent-step.ts` rejects every
non-Claude model at workflow definition time, regardless of which harness
is active. Until this is replaced, every shipped workflow that names a
codex- or gemini-shaped model fails validation with `unknown model "..."`
before it can run. This is the smallest, most blocking item in the
harness-portability initiative.

Goal:

Workflow agent step validation accepts any model the active preset (or
resolved harness) declares legal. No central allowlist of literal model
ids in core.

## Current state

`src/core/workflow/step-validators/validate-agent-step.ts:31-35`:

```ts
export const VALID_MODEL_IDS = new Set([
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
]);
```

Used at line 168:

```ts
const model = expectNonEmptyString(step.model, ...);
if (!VALID_MODEL_IDS.has(model)) {
  throw new WorkflowDefinitionError(
    `${stepLabel}.model: unknown model "${model}"`, definitionPath,
  );
}
```

This validator runs against every `WorkflowAgentStep` in every loaded
workflow. The same file resolves the step's `harness` (lines 204-215) —
so the harness is known at the moment we validate the model, but the
allowlist ignores it.

## Done when

- `VALID_MODEL_IDS` is deleted (or scoped to one shipped preset's
  catalog as a soft hint, never as an enforcement set in core).
- `validate-agent-step.ts` resolves the step's harness/preset and asks
  it to validate the declared model. Most adapters will simply accept
  any non-empty string and let the wire layer reject (this matches
  what codex and gemini already do — they pass `model` through
  verbatim to the SDK). Adapters that *do* know their catalog
  (e.g. claude-agent-sdk maintains a small set of supported models)
  can opt-in by exposing a `validateModelId(modelId): void` method on
  the harness contract. If absent, no central rejection.
- Workflow agent step accepts a `tier: ModelTier` field as an
  alternative to `model: string`. When `tier` is set, the resolver
  reads `preset.tiers[tier]` at run-construction time. This lets
  shipped workflows survive a preset swap without an edit.
- Existing workflows that hardcode `model: "claude-opus-4-7"` either
  migrate to `tier: "capable"` (preferred) or keep their literal, but
  no longer fail validation under codex/gemini because the central
  allowlist is gone. The autonomy fleet workflow defs and any in-tree
  workflow agent steps migrate to tier names in the same change.
- Tests:
  - The existing `src/workflow-validation.integration.test.ts` (or
    sibling) covers the new `tier` field, the dropped allowlist, and
    the per-harness opt-in `validateModelId` rejection path.
  - A regression test asserts that a step declaring
    `harness: "codex", model: "gpt-5-codex"` validates cleanly when
    the codex adapter is registered.
  - A regression test asserts that a step declaring
    `harness: "gemini", model: "gemini-2.5-pro"` validates cleanly
    when the gemini adapter is registered.

## Acceptance evidence

- Green run of `pnpm test workflow-validation` and any harness-parity
  test that exercises agent steps under non-claude harnesses.
- Diff that:
  - Deletes `VALID_MODEL_IDS` from `validate-agent-step.ts`.
  - Adds the optional `validateModelId` method to the `AgentHarness`
    contract in `src/core/agent-harness/types.ts`.
  - Adds `tier` resolution to the agent step input shape and
    runtime-dispatch.
  - Migrates in-tree workflow agent step definitions to use `tier`
    where appropriate (autonomy `AgentDef` entries, any builder/
    explorer/improver workflow steps that hardcode a literal model).

## Constraints

- Strict by default: the new `tier` field cannot coexist with the
  `model` field on the same step (`{ tier?, model? }` — set exactly
  one; throw on both or neither). Discriminated union, not optional
  fields admitting illegal combinations.
- No legacy: do not keep `VALID_MODEL_IDS` "for backwards compat".
  Existing workflows either pass through (string accepted) or migrate
  to tier (preferred).
- Per `AGENTS.md` strict-by-default: validate at the system boundary
  (workflow definition load), trust internal types after.

## Notes

- This task is small enough to land in one PR. It is listed as a
  separate inbox capture because it is the single most concrete blocker
  to migrating any workflow agent step off claude — fixable
  independently of the preset abstraction (set `tier` to literal and
  drop the allowlist; preset-aware tier resolution lands once the
  parent preset task does).
- The `effort` allowlist (`VALID_EFFORT_LEVELS` at the same file:36-42)
  is correct as-is — `AgentEffort` is genuinely a closed enum on the
  neutral protocol surface. Do not touch it.
