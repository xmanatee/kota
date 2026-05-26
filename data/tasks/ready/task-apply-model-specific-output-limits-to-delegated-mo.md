---
id: task-apply-model-specific-output-limits-to-delegated-mo
title: Apply model-specific output limits to delegated model calls
status: ready
priority: p2
area: core
summary: Resolve output-token budgets from typed model metadata for KOTA-native delegate and agent-harness model-client calls, so model tier overrides cannot run with stale hardcoded max_tokens values.
created_at: 2026-05-26T13:43:55.785Z
updated_at: 2026-05-26T13:43:55.785Z
---

## Problem

KOTA has a preset and model-tier surface so delegate routing can pick a
concrete model per task shape, and operators can override tier model ids.
Several KOTA-native model-client callers still pair the resolved model with a
fixed output-token request budget:

- `src/core/tools/delegate-turn.ts` sends `max_tokens: 8192` for every routed
  thin delegate call.
- `src/modules/thin-agent-harness/adapter.ts` sends `DEFAULT_MAX_TOKENS = 4096`
  for every model-client harness call.
- `src/modules/openai-tools-agent-harness/adapter.ts` has its own fixed
  request budget for the OpenAI-tools loop.

Those literals made sense when model routing was narrower, but they now sit
after model selection. If a shipped preset changes, or an operator maps a tier
to a model with a different output budget, KOTA can fail late with provider
length errors or run with a stale budget that does not match the selected
model. The bug is not about minimizing spend; it is about keeping the model
protocol strict after routing picks the model.

## Desired Outcome

KOTA has one typed source of truth for output-token request budgets for the
shipped model ids it owns. KOTA-native callers that invoke the `ModelClient`
after preset or tier routing use that source instead of local `max_tokens`
literals.

Operator model overrides remain explicit: an unknown model id must either
carry an intentional output-token limit through a typed boundary or fail with a
clear configuration error before the model request is sent. The selected model
id, limit source, and effective output-token budget should be visible in
focused tests or bounded diagnostics so a future preset edit cannot silently
drift.

## Constraints

- Keep provider-specific wire details in model-client modules. Core may own the
  neutral limit protocol for shipped presets, but it must not absorb broader
  provider catalogs.
- Do not add cost-aware autonomy routing. This task is about protocol
  correctness and late-failure prevention, not cheaper model selection.
- Do not leave a silent fallback that reuses the old literals for unknown
  operator overrides.
- Preserve the existing delegate mode turn limits and repeated-error circuit
  breaker; output-token limits are a separate boundary.
- Keep the change on the KOTA-native model-client paths. Native CLI harnesses
  that own their own model execution should continue to validate limits at
  their adapter boundary, not through a parallel core table.

## Done When

- A typed resolver maps every shipped preset tier model id to an output-token
  request budget, with focused coverage proving all shipped presets are covered.
- `delegate-turn`, the thin agent harness, and the OpenAI-tools agent harness
  consume the resolver instead of hardcoded `max_tokens` constants.
- Unknown operator tier/model overrides fail before request dispatch unless an
  explicit typed limit is supplied through the supported config/protocol
  boundary.
- Tests prove that a delegate route to a non-default tier uses that tier's
  configured model budget, and that changing the selected model changes the
  requested limit.
- Existing model-client, delegate, and agent-harness tests still pass.

## Source / Intent

Explorer run `2026-05-26T12-57-58-739Z-explorer-pt6h8c` reviewed an empty
actionable queue. The strategic blocked alternatives were considered, but all
remain real operator-capture waits and none are movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source: Goose v1.35.0, released May 22, 2026, includes a peer-runtime
fix named "Re-apply canonical limits when delegate overrides model". That is
the nonduplicative KOTA signal: KOTA already has preset and delegate routing,
but its KOTA-native model-client delegate paths still apply local token-budget
literals after selecting the model.

Research links:

- `https://github.com/aaif-goose/goose/releases/tag/v1.35.0`
- `https://github.com/aaif-goose/goose/pull/9183`

Local overlap check:

- `task-per-agent-model-override` and
  `task-replace-workflow-agent-step-model-allowlist-with-p` are done and cover
  model selection/validation, not routed output-token budgets.
- `task-add-shipped-preset-pricing-coverage-for-codex-a` is done and covers
  pricing, not provider request limits.
- Existing tool-call depth and agent-step runaway controls do not address the
  stale `max_tokens` value sent after model routing.

## Initiative

Harness-neutral model correctness: model selection, preset routing, and
delegation should carry strict model capabilities through to the provider
request instead of relying on stale per-caller constants.

## Acceptance Evidence

- Focused test transcript for the model-limit resolver and shipped preset
  coverage.
- Focused delegate/harness test transcript showing `delegate-turn`,
  `thin-agent-harness`, and `openai-tools-agent-harness` request the resolved
  budget for the selected model.
- Failure test transcript showing an unknown operator model override without an
  explicit limit fails before model dispatch.
- Static gates pass: `pnpm typecheck` and `pnpm test src/task-files.test.ts`.
