---
id: task-introduce-neutral-kotathinkingconfig-and-migrate-c
title: Introduce neutral KotaThinkingConfig and migrate core thinking-config surfaces
status: ready
priority: p2
area: architecture
summary: Implement Stage 3 of the Anthropic SDK type-surface audit: add a neutral KotaThinkingConfig and replace every Anthropic.Messages.ThinkingConfigParam reference inside src/core/ with it, translating at the model-client adapter seams.
created_at: 2026-04-24T05:18:59.557Z
updated_at: 2026-04-24T05:18:59.557Z
---

## Problem

`src/core/agent-harness/anthropic-type-audit.md` lays out a six-stage plan to
remove every `@anthropic-ai/sdk` type import from `src/core/`. Stages 1
(`KotaToolInputSchema`) and 2 (`KotaTool`) have landed; role (1)
"tool-definition / schema shapes" is entirely gone from core. The next
load-bearing Anthropic shape still referenced inside `src/core/` is the
reasoning/thinking config: `Anthropic.Messages.ThinkingConfigParam`.

Six core files still import that shape as the name of an internal contract:

- `src/core/loop/loop.ts` — private `thinkingConfig` field on the loop.
- `src/core/loop/loop-init.ts` — same field threaded through init.
- `src/core/loop/loop-send.ts` — passes the thinking config on each turn.
- `src/core/loop/pre-send-hooks.ts` —
  `PreSendContext.thinkingConfig?: Anthropic.Messages.ThinkingConfigParam`.
- `src/core/model/streaming.ts` — `StreamConfig.thinkingConfig?`.
- `src/core/model/model-client.ts` — `MessageStreamParams.thinking?`.

Every non-Anthropic provider (OpenAI o-series, local models) has to
encode/decode this Anthropic shape on both sides today. Leaving it in core
keeps provider-neutral model-client work nailed to one vendor's namespace
and blocks the Stage 4 `KotaMessage` migration because the loop and
model-client surfaces cannot drop their Anthropic import until this shape
also moves.

## Desired Outcome

A single neutral `KotaThinkingConfig` type owned by `src/core/agent-harness/`
(in `message-protocol.ts` beside `KotaTool` / `KotaToolInputSchema`) replaces
every `Anthropic.Messages.ThinkingConfigParam` reference inside `src/core/`.
The shape is structurally compatible with the SDK shape (`{ type: "enabled";
budget_tokens: number } | { type: "disabled" }`) so the adapter seams pass
the value through or translate with a small field-for-field helper. After
the migration, the six listed core files no longer reference
`Anthropic.Messages.ThinkingConfigParam`.

Module-side consumers that already speak the Anthropic wire format
(`src/modules/model-clients/anthropic.ts` and its tests) keep their
Anthropic-shaped literals because they test the translation seam itself.
The `src/modules/model-clients/openai/*` client's reasoning-effort
translation keys off `KotaThinkingConfig` rather than the Anthropic shape.
The `architect` module's internal use is out of scope for this stage; it
can adopt the neutral type later or continue speaking Anthropic at its own
seam.

## Constraints

- Implements Stage 3 of `src/core/agent-harness/anthropic-type-audit.md`
  exactly as scoped there — no scope creep into Stages 4–6.
- `KotaThinkingConfig` is a discriminated union, not an optional-field
  shape: `{ type: "enabled"; budget_tokens: number } | { type: "disabled" }`.
  Optional presence is expressed at the field site (`thinking?:
  KotaThinkingConfig`), not by a nullable branch inside the type.
- No parallel type appears beside an Anthropic shape. Every call site
  migrates in lockstep within this PR so the tree stays green.
- Adapter-side: the `model-clients/anthropic` module converts
  `KotaThinkingConfig` → `Anthropic.Messages.ThinkingConfigParam` at its
  seam (field-for-field). Do not re-export the Anthropic shape through
  core.
- No backwards-compatibility shim or "accept either shape" branch inside
  core. The Anthropic shape disappears from core in this PR.
- Tests that pass `thinkingConfig` literals (model-client, loop) switch
  to `KotaThinkingConfig` fixtures in the same PR.

## Done When

- `src/core/agent-harness/message-protocol.ts` exports
  `KotaThinkingConfig` with the two-variant discriminated union, and the
  type is re-exported from the agent-harness index alongside `KotaTool`.
- None of the six core files listed in Problem imports
  `Anthropic.Messages.ThinkingConfigParam`; they all type the field on
  `KotaThinkingConfig`.
- `src/modules/model-clients/anthropic.ts` translates `KotaThinkingConfig`
  → `Anthropic.Messages.ThinkingConfigParam` at its adapter seam with
  explicit field mapping (no `as` cast past the seam).
- `src/modules/model-clients/openai/*`'s reasoning translation keys off
  `KotaThinkingConfig`.
- Existing loop + model-client tests still pass unchanged in behavior;
  literal fixtures are updated to `KotaThinkingConfig` shape.
- `src/core/agent-harness/anthropic-type-audit.md` is updated to mark
  Stage 3 as landed (same pattern Stage 2 uses).
