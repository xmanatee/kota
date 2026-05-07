---
id: task-add-cross-preset-runtime-parity-gate
title: Add cross-preset runtime parity gate
status: backlog
priority: p2
area: architecture
summary: Add a single test target that boots the daemon under each shipped preset and runs an operator-shaped scenario (boot, single-turn, tool-use, capture, workflow agent step, autonomy turn) so cross-preset parity is verifiable, not nominal.
created_at: 2026-05-07T23:36:27.797Z
updated_at: 2026-05-07T23:36:27.797Z
---

## Problem

The operator is about to migrate from claude as the day-to-day driver
to codex/gemini for parts of the autonomy fleet. Today, the harness-
parity tests cover the adapter wire (`mcpServers`, abort propagation,
rails, prompt-input, hooks-cross-harness) but not the operator-visible
daemon path: starting the daemon under `--preset codex`, running a real
autonomy turn, capturing a note, recalling, completing a small
workflow agent step, observing push-notifications fire — none of that
is covered as a single gated suite. Without an end-to-end gate the
"swap one preset, everything follows" promise is not verifiable.

## Desired Outcome

A single test target (`pnpm test:preset-parity` or similar) that boots
the daemon under each shipped preset (`claude`, `codex`, `gemini`),
runs a small operator-shaped scenario, and fails loudly on any drift —
including silent fallback to a Claude model id, missing-env-var
skipped silently, or a feature that "works" on claude but is rejected
by codex/gemini at the adapter boundary without surfacing.

Scenario per preset (six surfaces, one assertion per surface):

1. **Boot** — `kota --preset <id> serve` and wait for the daemon to
   report ready. Required env var present; absent env var is a *fast
   skip with a clear message*, not a silent pass.
2. **Single-turn run** — send a deterministic prompt ("Reply with the
   single word OK"). Assert the response received, turns >= 1, the
   model id sent to the adapter equals `preset.defaultModel` (or the
   resolved tier when the call site picked one).
3. **Tool-using turn** — agent reads one file via the file-read tool
   and echoes a chunk back. Assert the harness's `canUseTool`
   pipeline fired.
4. **Capture pipeline** — route a one-line capture through capture/
   answer/recall. Assert the active preset's tier resolved correctly
   for each.
5. **Workflow agent step** — run one small workflow with a
   `WorkflowAgentStep` `tier: "balanced"` (after sibling task
   `task-replace-workflow-agent-step-model-allowlist-with-p` lands).
   Assert: step completes, resolved model in run record equals
   `preset.tiers.balanced`, no `claude-*` literal appears anywhere in
   the run record when the active preset is not claude.
6. **Autonomy turn** — enqueue a one-shot autonomy run (builder
   against a trivial fixture task). Assert the autonomy fleet's
   `AgentDef` resolves through the active preset, not a literal
   model id.

## Constraints

- Build on existing `src/{rails,abort,mcp-servers,prompt-input,hooks}-
  cross-harness.integration.test.ts` patterns. Do not duplicate their
  coverage; this task adds the *operator-visible end-to-end* layer
  above them.
- Per `AGENTS.md`: respect `area: client/channel` artifact rules. The
  daemon-boot run is a daemon route per the AGENTS.md taxonomy —
  capture transcripts under `.kota/runs/<run-id>/`.
- Do not introduce a "skip on flaky network" path that swallows
  provider-side errors. If a provider is rate-limiting or throwing,
  retry once and then fail visibly. Silent skips defeat the gate.
- Per `feedback_no_cost_bias_in_autonomy`: the scenario must not
  expose cost figures back into the autonomy run. Cost may be
  recorded in operator-facing transcripts; it must not feed into
  scenario decisions.
- Preset selection in the test is via the preset switch, not by
  flipping `--harness`. Whole point of the gate is to prove the
  preset-shaped switch works.

## Done When

The gate fails if:

- The active preset's `authEnv` is unset and the test silently
  skipped rather than emitting a single-line "preset X requires Y"
  report.
- Any model id sent to any adapter inside the run does not appear in
  the active preset's catalog (`defaultModel` or tiers) or a per-
  call `harnessOverrides.model` override that the test explicitly
  set.
- Any feature that succeeds on claude raises an "unsupported on this
  harness" error on codex/gemini *without* the failure being a
  known, documented adapter rejection.
- Any preset's run touches a literal `claude-*` / `gpt-*` /
  `gemini-*` outside the preset registry / pricing tables (cross-
  references the negative grep test from sibling task
  `task-eradicate-hardcoded-claude-model-defaults`).
- A `presetId` mismatch appears between the configured preset and
  the one recorded in the run state at run-start (sticky-preset
  invariant).

Concretely:

- A new test file (e.g. `src/preset-parity.integration.test.ts`)
  runs the scenario above for each shipped preset, parameterized.
- The test detects missing env vars and reports them as a single
  per-preset preflight failure rather than a flaky individual test.
- Test infrastructure under `src/eval-harness/` or
  `src/modules/eval-harness/` records the run artifacts for each
  preset under `.kota/runs/<run-id>/preset-parity/<preset-id>/` so
  a failed run produces a postmortem-grade transcript.
- CI either runs all three presets when env vars are configured, or
  produces a "preset X skipped: missing env" report that the
  operator can act on. Skipping is allowed; *silent* skipping is
  not.
- A final-state assertion sweeps every adapter run record and
  confirms the model id sent equals the resolved preset's
  tier/default — enforced via test instead of trusting
  documentation.

## Source / Intent

Owner phrasing (verbatim, do not normalize, from inbox capture
2026-05-07):

> мне нужно быть уверенным, что оно все реально будет работать на
> кодексе. И вот, удостоверяйся, что реально все элементы, все
> компоненты, они агностики по отношению к харнесу или модели

This task is the *consumer* of the preset abstraction, not its
first reader. Putting it in the same PR as the abstraction would
prevent honest review of either piece.

Useful side effect: the model-id sweep assertion is the strongest
invariant we can write against silent fallback. It is worth
shipping even if the larger scenario stays small for the first
iteration.

Order of operations:

1. Land sibling task `task-introduce-harness-preset-abstraction`.
2. Land sibling task
   `task-replace-workflow-agent-step-model-allowlist-with-p` so
   the workflow-agent-step assertion in the scenario can pass
   under codex/gemini.
3. Land sibling task
   `task-eradicate-hardcoded-claude-model-defaults` so the
   model-id sweep assertion is meaningful.
4. Then land this gate.

## Initiative

Harness-preset migration: this gate is the operator-visible
end-to-end proof that switching presets actually works.
Siblings: `task-introduce-harness-preset-abstraction`,
`task-replace-workflow-agent-step-model-allowlist-with-p`,
`task-eradicate-hardcoded-claude-model-defaults`.

## Acceptance Evidence

- A `pnpm test:preset-parity` invocation transcript captured
  under `.kota/runs/<run-id>/transcript.txt` showing all three
  presets passing on a host where all three env vars are set.
- A second transcript with one env var unset, showing the
  corresponding preset failing the preflight cleanly with an
  actionable error and the others passing.
- The model-id sweep assertion is executable as a stand-alone
  unit test for fast feedback (`vitest src/preset-parity` style),
  not only as part of the daemon-boot integration suite.

## Out of Scope

- Cost / latency benchmarking across presets. Different category;
  conflicts with `feedback_no_cost_bias_in_autonomy` if surfaced
  to autonomy.
- Full feature-matrix coverage. The scenario above is deliberately
  small — six surfaces, one assertion per surface. Operators can
  grow it once the abstraction is real.
- Bedrock / Vertex / OpenRouter providers. Ship the gate against
  the three primary presets first; downstream providers join
  once the shape is proven.
