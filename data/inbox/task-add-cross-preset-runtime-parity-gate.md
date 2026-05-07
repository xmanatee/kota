---
title: Add a cross-preset runtime parity gate that proves the daemon, autonomy fleet, and workflow steps work end-to-end under each shipped preset
created_at: 2026-05-07T00:00:00.000Z
source: owner
---

Owner intent:

Operator is about to migrate from claude as the day-to-day driver to
codex/gemini for parts of the autonomy fleet. Owner wants verifiable
confidence — not just unit tests — that switching the active preset works
end-to-end before relying on it. Today, the harness-parity tests cover the
adapter wire (`mcpServers`, abort propagation, rails, prompt-input,
hooks-cross-harness) but not the operator-visible daemon path: starting
the daemon under `--preset codex`, running a real autonomy turn, capturing
a note, recalling, completing a small workflow agent step, observing
push-notifications fire — none of that is covered as a single gated
suite.

Goal:

A single test target (`pnpm test:preset-parity` or similar) that boots the
daemon under each shipped preset (`claude`, `codex`, `gemini`), runs a
small operator-shaped scenario, and fails loudly on any drift —
including silent fallback to a Claude model id, missing-env-var skipped
silently, or a feature that "works" on claude but is rejected by codex/
gemini at the adapter boundary without surfacing.

Owner phrasing (verbatim, do not normalize):

> мне нужно быть уверенным, что оно все реально будет работать на кодексе.
> И вот, удостоверяйся, что реально все элементы, все компоненты, они
> агностики по отношению к харнесу или модели

## Scope of the parity scenario

For each shipped preset, run the same scenario. Scenario covers the
operator-visible surfaces, not just the harness wire:

1. **Boot**: `kota --preset <id> serve` (or daemon entry point) and wait
   for the daemon to report ready. Required env var must be present;
   absent env var is a *fast skip with a clear message*, not a silent
   pass.
2. **Single-turn run**: send a trivially-deterministic prompt
   ("Reply with the single word OK") via the harness REPL or a daemon
   request. Assert: response received, turns >= 1, the model id sent
   to the adapter equals `preset.defaultModel` (or the preset's
   resolved tier when the call site picked a tier).
3. **Tool-using turn**: ask the agent to read one file via the file-read
   tool, then echo a chunk back. Assert the harness's `canUseTool`
   pipeline fired and the result rendered in the transcript. Confirms
   guardrails compose correctly under each adapter.
4. **Capture pipeline**: route a one-line capture through the
   capture/answer/recall surfaces. Assert the active preset's tier
   resolved correctly for each (capture and answer pick their own
   tier from the preset; recall uses the embedding/sqlite-memory path
   which is preset-independent).
5. **Workflow agent step**: run one small workflow that contains a
   `WorkflowAgentStep` with `tier: "balanced"` (after sibling task
   `task-replace-workflow-agent-step-model-allowlist-with-preset`
   lands). Assert: step completes, the resolved model in the run
   record equals `preset.tiers.balanced`, no `claude-*` literal
   appears anywhere in the run record when the active preset is not
   claude.
6. **Autonomy turn**: enqueue a one-shot autonomy run (builder against
   a trivial fixture task). Assert the autonomy fleet's `AgentDef`
   resolves through the active preset, not a literal model id.

## Gate criteria

The gate fails if:

- The active preset's `authEnv` is unset and the test silently skipped
  rather than emitting a single-line "preset X requires Y" report.
- Any model id sent to any adapter inside the run does not appear in
  the active preset's catalog (`defaultModel` or `tiers.{fast,balanced,
  capable}`) or a per-call `harnessOverrides.model` override that the
  test explicitly set.
- Any feature that succeeds on claude raises an "unsupported on this
  harness" error on codex/gemini *without* the failure being a known,
  documented adapter rejection (the codex/gemini adapter AGENTS.md
  list which neutral options they reject — `mcpServers`, `supervised`,
  `harnessOverrides` of unsupported shape, etc.). Anything outside
  that documented list is a real regression.
- Any preset's run touches a literal `claude-*` / `gpt-*` /
  `gemini-*` outside the preset registry / pricing tables (cross-
  references the negative grep test from sibling task
  `task-eradicate-hardcoded-claude-model-defaults`).
- A `presetId` mismatch appears between the configured preset and the
  one recorded in the run state at run-start (sticky-preset invariant).

## Done when

- A new test file (e.g. `src/preset-parity.integration.test.ts`) runs
  the scenario above for each shipped preset, parameterized.
- The test detects missing env vars and reports them as a single
  per-preset preflight failure rather than a flaky individual test.
- Test infrastructure under `src/eval-harness/` or
  `src/modules/eval-harness/` records the run artifacts for each
  preset under `.kota/runs/<run-id>/preset-parity/<preset-id>/` so a
  failed run produces a postmortem-grade transcript.
- CI either runs all three presets when env vars are configured, or
  produces a "preset X skipped: missing env" report that the operator
  can act on. Skipping is allowed; *silent* skipping is not.
- A final-state assertion sweeps every adapter run record and confirms
  the model id sent equals the resolved preset's tier/default —
  enforced via test instead of trusting documentation.

## Acceptance evidence

- A `pnpm test:preset-parity` invocation transcript captured under
  `.kota/runs/<run-id>/transcript.txt` showing all three presets
  passing on a host where all three env vars are set.
- A second transcript with one env var unset, showing the
  corresponding preset failing the preflight cleanly with an
  actionable error and the others passing.
- The model-id sweep assertion is executable as a stand-alone unit
  test for fast feedback (`vitest src/preset-parity` style), not only
  as part of the daemon-boot integration suite.

## Constraints

- Build on existing `src/{rails,abort,mcp-servers,prompt-input,hooks}-
  cross-harness.integration.test.ts` patterns. Do not duplicate their
  coverage; this task adds the *operator-visible end-to-end* layer
  above them.
- Per `AGENTS.md`: respect `area: client/channel` artifact rules. The
  daemon-boot run is a daemon route per the AGENTS.md taxonomy —
  capture transcripts under `.kota/runs/<run-id>/` rather than
  inline test output.
- Do not introduce a "skip on flaky network" path that swallows
  provider-side errors. If a provider is rate-limiting / throwing,
  retry once and then fail visibly. Silent skips defeat the gate.
- Per `feedback_no_cost_bias_in_autonomy`: the scenario must not
  expose cost figures back into the autonomy run. Cost may be
  recorded in operator-facing transcripts; it must not feed into
  scenario decisions.
- Preset selection in the test is via the preset switch, not by
  flipping `--harness`. Whole point of the gate is to prove the
  preset-shaped switch works.

## Order of operations

1. Land sibling task `task-introduce-harness-preset-abstraction`.
2. Land sibling task
   `task-replace-workflow-agent-step-model-allowlist-with-preset`
   so the workflow-agent-step assertion in the scenario can pass
   under codex/gemini.
3. Land sibling task `task-eradicate-hardcoded-claude-model-defaults`
   so the model-id sweep assertion is meaningful.
4. Then land this gate.

## Out of scope

- Cost / latency benchmarking across presets. Fundamentally a
  different category; conflicting with `feedback_no_cost_bias_in_
  autonomy` if surfaced to autonomy.
- Full feature-matrix coverage. The scenario above is deliberately
  small — six surfaces, one assertion per surface. Operators can grow
  it once the abstraction is real.
- Bedrock / Vertex / OpenRouter providers. Ship the gate against the
  three primary presets first; downstream providers join once the
  shape is proven.

## Notes

- This task is the *consumer* of the preset abstraction, not its
  first reader. Putting it in the same PR as the abstraction would
  prevent honest review of either piece.
- A useful side effect: the model-id sweep assertion is the strongest
  invariant we can write against silent fallback. It is worth
  shipping even if the larger scenario stays small for the first
  iteration.
