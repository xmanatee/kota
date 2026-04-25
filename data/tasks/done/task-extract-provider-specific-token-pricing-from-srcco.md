---
id: task-extract-provider-specific-token-pricing-from-srcco
title: Extract provider-specific token pricing from src/core/loop/cost.ts into a model-pricing provider seam
status: done
priority: p2
area: architecture
summary: Move the hardcoded Claude pricing table out of core into a typed model-pricing provider that each model-client module registers, so core stops carrying provider-specific knowledge.
created_at: 2026-04-25T11:57:32.092Z
updated_at: 2026-04-25T12:04:39.310Z
---

## Problem

`src/core/loop/cost.ts` ships a hardcoded `PRICING` map keyed by Claude
model ids (`claude-sonnet-4-6`, `claude-opus-4-7`,
`claude-haiku-4-5-20251001`) plus a `DEFAULT_PRICING` fallback that
silently re-uses Sonnet's rates for any unknown model. This violates the
core boundary documented in `src/core/AGENTS.md` ("Provider
implementations live in `src/modules/model-clients/`") and in
`docs/ARCHITECTURE.md` ("General-purpose product capabilities should not
accumulate in the core by default").

Every other provider-specific concern in KOTA — model client wire
formats, tool-format adapters, harness loops — already lives in
`src/modules/model-clients/` or per-harness modules. Pricing is the
single remaining provider table inside core. The fallback also hides
real configuration drift: a typo in a model id, or a new provider added
without a pricing entry, both quietly bill at Sonnet rates instead of
failing loudly or reporting honest zero-cost.

The cost tracker itself is genuinely a session-loop primitive (every
session accumulates token usage and a dollar total for interactive cost
display) and stays in core. What needs to move is the provider-specific
pricing data and the lookup contract.

## Desired Outcome

- `src/core/loop/cost.ts` retains `CostTracker` and the `Usage` shape but
  no longer hardcodes any provider's per-million-token rates. Pricing is
  resolved through a typed provider seam (e.g.
  `getModelPricingProvider()` under `src/core/modules/provider-registry.ts`
  alongside the existing history/notification-hub seams), with an
  explicit "unknown model" outcome — either a loud failure or an
  explicit zero-cost record, but no silent Sonnet-rate fallback masking
  drift.
- Each model-client module under `src/modules/model-clients/` registers
  pricing for the models it owns during `onLoad`, the same way the
  history module registers its provider. New providers contribute
  pricing themselves; core never grows another entry.
- `addRawCost` (used today when the SDK reports `total_cost_usd`
  directly) keeps working unchanged, so harnesses that bypass per-token
  pricing — e.g. agent-SDK runs that surface a final dollar total — are
  not regressed.
- A focused test asserts that `CostTracker.addUsage` against a model id
  with no registered pricing produces the explicit unknown-model outcome
  the new contract specifies, not Sonnet-rate cost. This is the
  invariant that catches future drift.

## Constraints

- The autonomous side of KOTA must not start receiving new cost signals.
  Per project memory, agent-facing cost feeds are forbidden; user-facing
  display is fine. The seam is purely a refactor of where the pricing
  data lives — the cost tracker's outputs remain available only to the
  same callers (loop-send, mcp-server, interactive transcripts).
- Keep the seam consistent with existing provider-registry patterns
  (history, notification-hub, workflow-dispatcher,
  workflow-metrics-source, workflow-definitions). Do not introduce a new
  registry style.
- Decide and document the unknown-model outcome explicitly. "Silently
  bill at Sonnet rates" is the current bug, not the contract — pick
  loud failure (recommended for autonomous paths) or explicit zero
  (recommended if interactive sessions must keep displaying a number),
  and pick once.
- Update the relevant local `AGENTS.md` files — at minimum
  `src/core/loop` (or its parent) and `src/modules/model-clients` — so
  the new ownership is discoverable from code.
- Strict types only: no `?` pricing fields, no permissive coercion.
  Provider rate registration is either complete for a registered model
  id or absent.

## Done When

- Core no longer carries Claude (or any other provider's) pricing
  table; `grep -nE "claude-(sonnet|opus|haiku)" src/core/` shows no
  pricing rows.
- Each shipped model-client module registers pricing for its own models
  through the new seam at `onLoad`.
- `CostTracker.addUsage` queries the seam and behaves as the chosen
  unknown-model contract specifies, with at least one focused test
  pinning that behavior.
- Existing CostTracker callers (`loop-send`, `mcp-server`,
  `delegate-harness.integration.test.ts`) continue to produce the same
  totals for known models; the integration test passes unchanged.
- `docs/ARCHITECTURE.md` and the affected `AGENTS.md` files reflect the
  new ownership without listing model ids or rates (those belong in
  module code).

## Source / Intent

Surfaced by an empty-queue exploration cycle on 2026-04-25 reviewing
`src/core/` for remaining provider-specific surfaces after the recent
core-shrink wave that migrated `/api/tasks`, `/history/*`, `/voice/*`,
`/approvals*`, `/owner-questions*`, `/push-tokens`, `/commands*`,
`/metrics`, the static web UI, the inbound webhook event-trigger route,
and the signature-validated `/webhooks/:name` route out of core. With
HTTP routes settled, the hardcoded Claude pricing table is the most
visible provider-specific table still living in core/loop. The silent
Sonnet-rate fallback in `DEFAULT_PRICING` also hides configuration
drift, which is exactly the kind of "permissiveness without explicit
justification from the domain" the monorepo standards forbid.

## Initiative

Core-shrink / module-first architecture: keep `src/core/` protocol-
oriented and push provider-specific data out to its owning module.

## Acceptance Evidence

- Test output showing the new unknown-model contract enforced (e.g.
  `pnpm test src/core/loop/cost.test.ts`) plus passing integration
  coverage for known-model totals.
- Diff that adds `getModelPricingProvider()` (or equivalent named seam)
  under `src/core/modules/provider-registry.ts`, drops the `PRICING`
  table from `src/core/loop/cost.ts`, and adds pricing registration to
  each shipped model-client module's `onLoad`.
- Updated `AGENTS.md` text under `src/modules/model-clients/` declaring
  pricing ownership.
