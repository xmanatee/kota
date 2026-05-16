---
id: task-add-shipped-preset-pricing-coverage-for-codex-a
title: Add shipped-preset pricing coverage for Codex and Gemini models
status: done
priority: p2
area: modules
summary: Register model-pricing rows for the non-Anthropic shipped preset models so operator-facing cost reports do not show honest-but-misleading zero dollars for Codex/OpenAI and Gemini runs.
created_at: 2026-05-16T03:23:56.349Z
updated_at: 2026-05-16T03:40:16.764Z
---

## Problem

KOTA's shipped default preset is `codex`, with OpenAI model ids such as
`gpt-5.5`, `gpt-5.4`, and `gpt-5.4-mini`. The shipped `gemini` and
`gemini-cli` presets use Gemini 2.5 model ids. Those presets can produce token
usage today, but `src/modules/model-clients/` only registers Anthropic pricing.

`CostTracker` intentionally treats missing pricing rows as `$0` so unknown
external models do not crash operator reporting. That is the right behavior for
true unknowns, but it is misleading for KOTA's own shipped presets: normal
Codex/OpenAI and Gemini runs can appear free in operator-facing workflow cost
summaries. The gap is module-owned provider data and coverage, not a core
cost-routing policy.

## Desired Outcome

`src/modules/model-clients/` registers pricing coverage for every shipped
non-Anthropic preset model that emits token usage:

- OpenAI/Codex preset ids: `gpt-5.5`, `gpt-5.4`, and `gpt-5.4-mini`.
- Gemini preset ids: `gemini-2.5-pro`, `gemini-2.5-flash`, and
  `gemini-2.5-flash-lite`.

If a shipped model cannot be represented by the current flat `ModelPricing`
shape, the implementation either extends the provider contract in a strict
typed way or records an explicit unpriced rationale that tests can assert.
Operator-facing cost summaries should produce nonzero dollar estimates for
representative synthetic usage against priced shipped models, while true
unknown models keep the existing `$0` behavior.

## Constraints

- Keep pricing rows module-owned under `src/modules/model-clients/`; do not
  reintroduce a core pricing table.
- Do not add cost-aware autonomy routing, model selection, task prioritization,
  or prompt-visible cost signals. These estimates are operator-facing only.
- Use official provider pricing sources for rates. Do not infer durable rates
  from blog posts, package metadata, or third-party tables.
- Preserve strict internal protocol behavior. If tiered pricing requires a
  richer contract, make that contract explicit instead of adding nullable
  fields, silent fallbacks, or ad-hoc string parsing.
- Add a guard that enumerates shipped preset model ids and fails when one lacks
  pricing or an explicit unpriced rationale.

## Done When

- The registered model-pricing provider covers Anthropic plus the shipped
  OpenAI/Codex and Gemini preset ids, or exposes a typed explicit rationale for
  any shipped id that cannot be priced.
- Focused tests enumerate the models from `listShippedPresets()` and fail if a
  shipped preset model lacks pricing coverage or explicit unpriced status.
- `CostTracker` tests show nonzero costs for representative usage against
  `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gemini-2.5-pro`,
  `gemini-2.5-flash`, and `gemini-2.5-flash-lite` when those ids are priced.
- Official source URLs and observation dates are captured in a focused fixture,
  test comment, or run artifact without turning durable docs into a rate
  catalog.
- Existing unknown-model `$0` behavior remains covered by tests.

## Source / Intent

Explorer run `2026-05-16T03-23-56-349Z-explorer-8w57z2` reviewed an empty
actionable queue. The strategic blocked tasks were all still gated on operator
capture, so this opens a ready module-owned observability slice instead of
adding another blocked item.

Local evidence:

- `src/core/model/preset.ts` ships Codex/OpenAI and Gemini model ids.
- `src/modules/model-clients/index.ts` currently registers only the Anthropic
  pricing provider.
- `src/modules/model-clients/anthropic-pricing.ts` demonstrates the intended
  module-owned pricing pattern.
- `src/core/loop/cost.ts` treats missing pricing as `$0`, which is intentional
  for unknown models but misleading for shipped defaults.

Official pricing sources observed during the run on 2026-05-16:

- `https://openai.com/api/pricing/`
- `https://ai.google.dev/gemini-api/docs/pricing`

## Initiative

Provider-neutral operator observability: shipped presets should give accurate
operator-facing cost accounting without making autonomy optimize for cost.

## Acceptance Evidence

- Test transcript for the focused pricing and preset suites, for example
  `pnpm test src/core/loop/cost.test.ts src/modules/model-clients/*.test.ts src/core/model/preset.test.ts`.
- A focused test or fixture enumerates shipped preset model ids and their
  pricing status.
- A run artifact under `.kota/runs/<run-id>/pricing-coverage/` records the
  official pricing sources, observation date, and representative cost
  calculations used to verify the implementation.
