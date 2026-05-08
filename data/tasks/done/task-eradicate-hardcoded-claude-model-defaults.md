---
id: task-eradicate-hardcoded-claude-model-defaults
title: Eradicate hardcoded claude-* model defaults
status: done
priority: p1
area: core
summary: Eradicate hardcoded claude-* model defaults across CLI, daemon, delegate config, autonomy fleet, and per-module defaults; route all defaults through the active preset and enforce the absence with a negative grep test.
created_at: 2026-05-07T23:34:26.525Z
updated_at: 2026-05-08T01:25:46.414Z
---

## Problem

Once a preset abstraction exists (sibling task
`task-introduce-harness-preset-abstraction`), every place in production
code that today defaults to a Claude-shaped model literal must instead
query the active preset. Without this sweep, switching the harness to
codex/gemini still ships `claude-sonnet-4-6` or `claude-opus-4-7` to the
new SDK at multiple call sites.

Inventory of hits in production code (snapshot 2026-05-07, all paths
under `src/`):

CLI defaults:
- `src/cli.ts:113` — `opts.model || config.model || "claude-sonnet-4-6"`
  in the `--harness` / `agent-sdk` branch of `kota run`
- `src/cli.ts:167` — same fallback in the classic-loop branch
- `src/cli.ts:248` — same fallback in the pipe-mode handler
- `src/cli.ts:87` — option help string says `(default: claude-sonnet-4-6)`

Delegate / loop defaults:
- `src/core/tools/delegate-config.ts:42` — singleton init
  `model: "claude-opus-4-7"`
- `src/core/loop/loop-constructor.ts:42` —
  `state.model = options.model || "claude-sonnet-4-6"`
- `src/core/model/model-router.ts:19-23` — `DEFAULT_MODEL_TIERS` literal
  (haiku/sonnet/opus). Imported at `src/core/model/index.ts:28`. Used by
  `routeModel()` and `resolveModelForTier()` as the global fallback.
- `src/core/model/mock-client.ts:138,165,186` — three response stubs
  hardcode the haiku id.

Daemon path:
- `src/core/daemon/daemon-init.ts:135` — `getHistoryProvider().create(
  daemonModel ?? "claude-sonnet-4-6", projectDir, "user")`. Fires when
  `config.model` is unset (the common case).

Autonomy fleet:
- `src/modules/autonomy/shared.ts:51` — `AUTONOMY_AGENT_DEFAULTS = {
  model: "claude-opus-4-7", … }`. Single source of truth for every
  autonomy `AgentDef`.

Per-module defaults:
- `src/modules/init/index.ts:14` — scaffolded config example shows
  `# model: "claude-sonnet-4-6"`
- `src/modules/capture/index.ts:100` — `model: config.model ||
  "claude-sonnet-4-6"`
- `src/modules/answer/index.ts:131` — same fallback
- `src/modules/mcp-server/server.ts:78` — `samplingModel:
  options.samplingModel ?? "claude-sonnet-4-6"`
- `src/modules/mcp-server/mcp-server-operations.ts:38` — `model:
  config.model || "claude-sonnet-4-6"`
- `src/modules/history/cli.ts:98` and `:237` — `claude-sonnet-4-6`
  fallbacks

Harness-parity helper:
- `src/modules/harness-parity/harness-parity-operations.ts:32` —
  `const DEFAULT_MODEL = "claude-sonnet-4-6";`
- `src/modules/harness-parity/runner.ts:28` — JSDoc example references
  the same literal
- `src/modules/harness-parity/cli.ts:70-71` — option default

Doctor probe:
- `src/modules/doctor/doctor-checks.ts:259-260` — `PROBE_MODEL =
  { anthropic: "claude-haiku-4-5-20251001", openai: "gpt-4o-mini" }`.
  Probe table is legitimate but must cover gemini and any other
  shipped preset before `kota doctor` becomes a real preflight.

Pricing tables (legitimate — keep, but document):
- `src/modules/model-clients/anthropic-pricing.ts:9-11` — provider-
  shaped pricing, not a default. Keep.

Workflow validator (covered by separate sibling task):
- `src/core/workflow/step-validators/validate-agent-step.ts:31-35` —
  `VALID_MODEL_IDS` allowlist. Tracked separately by
  `task-replace-workflow-agent-step-model-allowlist-with-p`; do not
  fix here.

## Desired Outcome

Every entry above (except the explicitly-keep pricing tables) reads its
default from the active `Preset` instead of a literal. A grep of
production code (excluding `*.test.ts`, fixtures, the preset registry,
and adapter-internal pricing) returns zero hits for
`\b(claude-(opus|sonnet|haiku)-[0-9]|gpt-[0-9]|gemini-[0-9])`. The
absence is enforced by a negative test that fails on any future
regression.

## Constraints

- Strict by default (`AGENTS.md`): drop the `?? "claude-..."` fallback
  in every consumer. If preset resolution returns nothing, throw with
  a message that names the consumer and the missing preset/config
  field.
- No legacy: do not introduce a "use literal claude id when preset
  unset" compat path. Preset is required.
- Per `feedback_no_cost_bias_in_autonomy`: autonomy module changes must
  not introduce cost-aware routing logic, even though tier mapping
  affects cost. Tier choice is preset-data, not autonomy-runtime.
- Respect adapter ownership: provider-specific pricing
  (`anthropic-pricing.ts` and any future siblings) keeps real model
  ids — that file is the owning adapter for that data.
- Do not touch sibling task scope (workflow agent step allowlist;
  preset abstraction itself).

## Done When

- The expected API from the parent task (`resolveDefaultModel(preset)`,
  `resolveTierModel(preset, tier)`, `resolveDefaultEffort(preset)`) is
  used at every consumer above.
- A negative integration test greps `src/**/*.ts` (excluding
  `*.test.ts`, `*-pricing.ts`, the preset registry file, and per-
  adapter SDK-internal model probe tables) for the regex
  `\b(claude-(opus|sonnet|haiku)-[0-9]|gpt-[0-9]|gemini-[0-9])` and
  fails if any literal model id appears outside the allowlisted files.
  Modeled after
  `src/core/agent-harness/no-anthropic-imports-in-core.test.ts`.
- The autonomy fleet's `AUTONOMY_AGENT_DEFAULTS` is rewritten in terms
  of a tier name (`tier: 'capable'`) plus a default effort, both
  resolved through the active preset at agent-construction time. No
  literal model id stays in `src/modules/autonomy/shared.ts`.
- `kota run` without `--model`, `--harness`, or `--preset` either uses
  the configured `defaultPreset` or fails loudly with a single-line
  error naming the missing config key.
- `daemon-init.ts` resolves its default from the preset, not a literal.
- `mock-client.ts` uses a sentinel literal scoped to the mock
  (e.g. `MOCK_MODEL_ID = "mock-test-model"`), or reads the active
  preset's default — pick whichever keeps existing tests green.
- Doctor probe table (`PROBE_MODEL`) is preset-derived: one entry per
  shipped preset, covering at least claude / codex / gemini.
- Harness-parity defaults flow from the active preset; the `--model`
  option becomes optional and inherits.

## Source / Intent

Owner intent (verbatim, from inbox capture 2026-05-07):

> Operator wants to be sure no part of the system silently keeps
> sending `claude-sonnet-4-6` or `claude-opus-4-7` to OpenAI/Gemini
> after switching the harness. This is a sweep-and-verify task with a
> long blast radius across CLI, daemon, autonomy fleet, delegate
> config, and per-module defaults.

This task is the *consumer* of the preset abstraction; it lands after
`task-introduce-harness-preset-abstraction` so each consumer has
somewhere to read its default from.

Order of operations:

1. Land `task-introduce-harness-preset-abstraction` first.
2. Wire CLI + daemon-init + delegate-config defaults to the preset
   first.
3. Module-level defaults (capture, answer, history, mcp-server,
   harness-parity) follow.
4. Autonomy `AUTONOMY_AGENT_DEFAULTS` migration last.
5. The negative grep test lands in the same PR as the last consumer
   migration so the invariant is enforced from then on.

## Initiative

Harness-preset migration: this sweep is the verifiable absence-of-
fallback that proves the preset abstraction is real, not nominal.
Siblings: `task-introduce-harness-preset-abstraction`,
`task-replace-workflow-agent-step-model-allowlist-with-p`,
`task-add-cross-preset-runtime-parity-gate`.

## Acceptance Evidence

- Diff that touches every file in the inventory above plus the new
  preset-aware test under `src/`.
- A green run of the new grep test included in the PR body.
- A `pnpm kota run` transcript under each of `claude`, `codex`,
  `gemini` presets showing the announce-active-harness banner
  reporting the preset's `defaultModel`, never a Claude id when the
  active preset is not claude — captured under
  `.kota/runs/<run-id>/transcript.txt`.
- A `pnpm kota autonomy ...` run under `--preset codex` with the
  autonomy fleet's resolved model id surfaced in
  `.kota/runs/<run-id>/`. The model id must equal the codex preset's
  `tiers.capable`, not `claude-opus-4-7`.

## Notes

- Mock client (`src/core/model/mock-client.ts`) is currently using
  `claude-haiku-4-5-20251001` as a stand-in. Replace with a sentinel
  scoped to the mock — production code should never read the mock's
  model literal as a default.
- The `init` module's scaffolded `config.json` example should switch
  to `defaultPreset: "claude"` (or whatever ships as the default
  preset) rather than `model: "claude-sonnet-4-6"`. New users start
  aligned with the preset abstraction.
- This task is fundamentally bounded — every hit is in the inventory
  above. If implementation surfaces a hit not listed, add it here in
  the same commit. The grep test prevents future hits from creeping
  in unobserved.
