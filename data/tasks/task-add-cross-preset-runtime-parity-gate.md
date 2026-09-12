---
status: blocked
priority: p2
---
# Add cross-preset runtime parity gate

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

- An env-auth preset's `authEnv` is unset and the test silently skipped
  rather than emitting a single-line "preset X requires Y" report.
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
- The test accepts harness-managed-auth presets and detects missing env vars
  for env-auth presets as a single per-preset preflight failure rather than a
  flaky individual test.
- Test infrastructure under `src/modules/eval-harness/` records the run
  artifacts for each
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

## Status (2026-06-15 blocked audit)

`pnpm run test:preset-parity` still passes locally (62 passed, 6 skipped).
`kota doctor --preset codex` and `kota doctor --preset gemini-cli` report
harness-managed auth ready. `kota doctor --preset claude` fails because
`ANTHROPIC_API_KEY` is absent, and `kota doctor --preset antigravity-cli` fails
because `agy` auth cannot be verified non-interactively. This confirms the
test infrastructure works, but it does not satisfy the requested
all-auth-present and one-auth-missing transcript pair.

2026-06-15 follow-up: `agy --version` reports 1.0.8 and a live
`agy --print "Reply with exactly: ok"` smoke test returns `ok`, so AGY
execution itself is available locally. The remaining Antigravity parity caveat
is the doctor auth contract: AGY stores login state in the OS keyring and does
not expose a documented headless auth-status command, so `doctor --preset
antigravity-cli --skip-connectivity` stays conservative even though a live
one-shot run can work.

## Current disposition (2026-09-10)

Reopened for unfinished product coverage, separate from live credentials. The
current src/preset-parity.integration.test.ts around line 222 runs a single-turn
CLI smoke, not all six operator-visible surfaces required above. Complete the
small composed daemon/tool/capture/workflow/autonomy scenario through existing
runtime/testing abstractions. Do not duplicate adapter tests or pin literal
configuration/model values; assert actual resolution and public behavior.

Host preflight today: Codex login works; AGY authenticated models works. Claude
and Gemini API credentials are absent through the checked scope/environment
resolver. Each preset must follow its actual API-key or harness-managed auth
contract, not a requirement for all presets to expose environment variables.
Missing auth remains an explicit unexecuted row, not a passed live gate.
No mandatory human execution or historical capture-directory name is required.
Build and validate the composed mechanism now; use authorized execution for the
all-ready/missing-auth evidence when available. Keep actual external prerequisites
explicit without blocking independent implementation or silently reducing the
six-surface acceptance to a smoke test.

## Implementation and validation (2026-09-12)

Replaced the single-turn smoke with a disposable built-daemon scenario covering
single/tool workflow agent turns, capture/recall/answer, a balanced workflow, and the shipped
builder AgentDef on a read-only fixture task. The last probe tests fleet agent
resolution through ordinary workflow admission; it does not exercise builder
publication. Adapter/model-client observations include failed calls, resolved
workflow steps, and run-start preset attribution. The standalone sweep rejects
foreign models, wrong tiers, missing model selection, and sticky-preset drift.
Only established missing/stale auth can skip; probe/runtime failures remain
failures. Codex's declared native-tool rejection of `canUseTool` is reported
explicitly alongside its file-read outcome, not counted as a fired callback.

Evidence for run `2026-09-12T10-21-57-838Z-builder-bzsmbp` is under its runtime
`agent/` directory:

- `parity-sweep-final.log`: eight owner cases pass, including negative fallback
  and run-start checks.
- `parity-integration-final.log`: all three production workflow compilation
  cases pass; the real built CLI reaches startup but its listener fails with
  `listen EPERM: operation not permitted 127.0.0.1`.
- `parity-check-fast-final.log`: static gate passes (types, lint, task validation,
  generated bindings). Subsequent observation/error-reporting edits were checked
  with typechecking and scoped Biome.
- `parity-live-preflight.log` and `preset-parity/{claude,gemini}/`: actual live
  target selection reports both missing API-auth rows to stdout and artifacts.
  Neither row ran inference. Codex was excluded from this restricted-auth probe;
  this is not evidence that host Codex login is unavailable.
- `pnpm build` failed while deleting existing output directories under this
  sandbox. The equivalent TypeScript emission and runtime asset-copy commands
  then succeeded. This does not claim the clean-build command passed.

These checks support retaining the gate implementation, but cannot establish
that the HTTP journey or live provider interactions pass.

The retained critic's provider-configuration defect is repaired: disposable
scopes now configure the actual ModelClient provider for capture/answer, including
Gemini's compatible endpoint and an environment-variable reference. Native Codex
login and the separate OpenAI API prerequisite are reported distinctly.
`parity-provider-repair.log` records six passing cases: three production workflow
compilations and three real config-loader/client-factory regressions. The latter
reproduce rejection without provider configuration and establish construction
with the fixture's configuration, using synthetic credentials without inference.
`parity-provider-check-resumed.log` records a passing complete static gate after
replacing a vanished prior-session temporary directory with the run directory.
The earlier failed static invocation remains in `parity-provider-check.log`.
These results resolve the configuration regression checks; they do not establish
live six-surface acceptance or a new critic approval. The diff and critic evidence
remain intact for runtime-owned preservation of this same run lineage.

The chat/harness composition defect from the subsequent critic is repaired.
Single-turn and file-read stimuli now trigger ordinary daemon workflow agent
steps at the explicit balanced tier. Assertions use completed harness calls tied
to each run, including turns and file-read permission callbacks; native rejection
annotations now describe the adapter that actually executed. Session chat's
ModelClient path is no longer used to claim harness coverage. The balanced model
sweep covers these surfaces too. The executor regression controls only the
external harness invocation and verifies the real agent-step/observer boundary;
it does not establish live SDK callback behavior or HTTP acceptance.

## Blocked on

kind: operator-capture
path: .kota/runs
description: Task-attributable availability of authorized disposable-daemon execution with loopback binding and the presets' provider authentication.

The evidence-review kind records execution availability; its path is a discovery
hint. Reopen as soon as a permitted invocation is established. Running and
assessing the live journeys remains this task's work.

An authorized execution context able to bind the disposable daemon's loopback
listener and access each preset's actual provider/auth contract is required for
the remaining live acceptance. The current execution profile denies the listener
and protects native login state. Claude/Gemini API variables were absent in the
scoped probe. No callable scoped host-execution/export tool was available in this
agent session; no parent daemon, protected credentials, or other writer was touched.

Resume with the built-daemon integration case and the full live target in such a
context, inspect all six surfaces and adapter-call sweeps, and capture both the
all-ready run and one-missing-auth run with the other presets completing. Repair
any observed composition defects before marking done. Equivalent attributable
execution evidence is acceptable; no manual operator run or fixed artifact path
is required. Live acceptance remains unmet, not silently waived by passing static
checks or explicit skips.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-12T19:14:11.234Z -->
