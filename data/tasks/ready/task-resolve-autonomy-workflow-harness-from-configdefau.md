---
id: task-resolve-autonomy-workflow-harness-from-configdefau
title: Resolve autonomy workflow harness from config.defaultAgentHarness instead of the hardcoded constant
status: ready
priority: p2
area: architecture
summary: Every autonomy workflow and judge hardcodes AUTONOMY_AGENT_HARNESS="claude-agent-sdk", and the CLI plus the agent-sdk delegate silently fall back to the same name — so operators cannot actually switch autonomy via config.defaultAgentHarness the way the config contract advertises.
created_at: 2026-04-23T02:53:25.868Z
updated_at: 2026-04-23T02:53:25.868Z
---

## Problem

The recent harness-neutrality work (`task-make-autonomy-agent-steps-and-judges-
harness-neutr`, `task-stop-building-a-claudecode-preset-systemprompt-at-`,
`task-wire-agent-step-effort-through-the-openai-tools-ha`) made the autonomy
agent-step and judge paths *capable* of running under any registered harness.
What did not move is which harness name they actually resolve. Three sites
still silently pin the resolution to claude-agent-sdk:

- `src/modules/autonomy/shared.ts` exports
  `AUTONOMY_AGENT_HARNESS = "claude-agent-sdk"`. Every autonomy workflow
  (`builder`, `critic`/judge call in `critic.ts`, `improver`, `decomposer`,
  `explorer`, `inbox-sorter`, `pr-reviewer`, `research-retry`) imports that
  constant and passes it as `harness:` or `config.harness ?? AUTONOMY_AGENT_HARNESS`.
  Operators who set `config.defaultAgentHarness: "openai-tools"` in
  `.kota/config.json` still get claude-agent-sdk for every autonomy step and
  every judge — the config field has no effect on autonomy.
- `src/cli.ts` (`kota run`, both branches including the piped-stdin branch) has
  `?? "claude-agent-sdk"` as its final fallback when both `--harness` and
  `config.defaultAgentHarness` are unset. The config doc on
  `KotaConfig.defaultAgentHarness` in `src/core/config/config.ts` advertises
  the opposite invariant — "There is no implicit default — KOTA does not
  silently pick claude-agent-sdk when unset" — and
  `src/core/agent-harness/AGENTS.md` restates it: "There is no implicit
  default — failing to select a harness is a loud error, never a silent
  fallback to claude-agent-sdk." The CLI contradicts both.
- `src/core/tools/delegate-agent-sdk.ts` (the harness delegate backend) keeps
  `const harnessName = config.harness ?? "claude-agent-sdk";` for its own
  fallback, independent of `config.defaultAgentHarness`. Subagents launched
  through the delegate tool are pinned to claude regardless of operator
  configuration, for the same reason autonomy is.

Together these pin the "general-purpose coding agent across pluggable
harnesses" claim to claude-agent-sdk everywhere autonomy and subagents
actually run, even after the per-call plumbing stopped caring which adapter
answers. The gap is resolution, not capability.

## Desired Outcome

Every autonomy workflow step, autonomy judge, and subagent delegate dispatches
through the harness name the operator configured. Concretely:

- Autonomy workflows and `invokeAgentJudge` no longer spread or default to
  `AUTONOMY_AGENT_HARNESS`. They resolve a harness name from the operator's
  configuration at step-execution / judge-dispatch time. The step executor
  and judge primitive are the single place that reads
  `config.defaultAgentHarness`; workflow step declarations stay harness-
  agnostic unless they genuinely require a specific adapter and override
  `harness` explicitly with a documented reason.
- The CLI (`kota run` interactive + single-shot + piped-stdin) and the
  agent-sdk delegate stop ending their resolution chain with
  `?? "claude-agent-sdk"`. If `config.defaultAgentHarness` is unset and no
  per-invocation override was provided, they fail loudly with the same
  "no registered default" error shape the `agent-harness` AGENTS doc already
  promises. The config doc's stated invariant matches the code.
- `AUTONOMY_AGENT_HARNESS` is either deleted outright or narrowed to a
  single test-local constant with a comment explaining why — it must not
  survive as a production-code knob that quietly re-pins the fleet.
- Tests that exercise autonomy run under both harnesses (at minimum claude-
  agent-sdk and a stubbed openai-tools ModelClient) prove resolution flows
  end-to-end: the critic judge, at least one autonomy workflow step, and
  the delegate tool all route through the operator-configured harness and
  not the old constant.

## Constraints

- No dual path. After the change, `AUTONOMY_AGENT_HARNESS = "claude-agent-sdk"`
  must not remain as a production fallback. Silent fallbacks that re-pin the
  operator-configurable harness belong nowhere in production code.
- Do not teach step validators, workflow definitions, or the critic to branch
  on harness *name*. Capability belongs to the adapter (`askOwnerToolName`,
  `emitsAgentMessageStream`, declared hook kinds); resolution belongs to the
  operator's config. Name-based branching is the coupling this task closes.
- Keep the "loud failure when unset" contract as the single source of truth.
  If `config.defaultAgentHarness` is undefined and no per-step / per-call
  override is passed, throw the same `resolveAgentHarness` error listing
  registered names — matching the existing `src/core/agent-harness/registry.ts`
  behavior. No silent substitution.
- Per-workflow or per-judge `harness` overrides stay legal. They express
  "this step genuinely needs a specific adapter" (e.g. a claude-only feature
  test) and must be accompanied by a short comment explaining why. The
  default path reads config; overrides opt out.
- Do not introduce a new `ctx.defaultHarnessName` surface in workflow step
  context just to paper over the constant. The step executor already resolves
  other defaults from config at execution time (see how `defaultAgentHarness`
  is treated in the CLI / step-executor paths); extend that instead of adding
  a parallel resolver.
- Keep the autonomy fleet tests stubbed. Reuse the fake ModelClient / stubbed
  adapter pattern from
  `src/modules/openai-tools-agent-harness/adapter.integration.test.ts` and
  `autonomy-harness-neutral.integration.test.ts` for the openai-tools side.
  No live adapter calls in CI.
- Do not widen scope to interactive session (`src/core/loop/`) harness
  selection — that path already routes through the classic-loop branch and is
  separate. The task targets autonomy workflows, autonomy judges, the `kota
  run` CLI branches that already dispatch via `runAgentHarness`, and the
  delegate backend.

## Done When

- `AUTONOMY_AGENT_HARNESS` is removed from `src/modules/autonomy/shared.ts` (or
  reduced to a narrowly-scoped test helper with an explanatory comment). No
  autonomy workflow file imports it as a production default. A grep for
  `AUTONOMY_AGENT_HARNESS` across `src/modules/autonomy/` returns only
  test fixtures, if anything.
- Autonomy workflow agent steps and `invokeAgentJudge` in
  `src/modules/autonomy/critic.ts` resolve their harness from the operator-
  configured `config.defaultAgentHarness` (with per-step / per-call override
  still honored). A focused test asserts that under a test config whose
  `defaultAgentHarness` is `"openai-tools"`, a representative autonomy step
  and an `invokeAgentJudge` call both dispatch to the stubbed openai-tools
  adapter — not to claude-agent-sdk.
- `src/cli.ts` (both the `kota run` branches and the piped-stdin branch) and
  `src/core/tools/delegate-agent-sdk.ts` stop ending their fallback chain with
  `?? "claude-agent-sdk"`. A focused test or CLI-smoke assertion confirms
  that with `config.defaultAgentHarness` unset and no `--harness` flag, the
  CLI fails with the registry's "no default harness configured" error (same
  error shape the registry already produces for unknown names), and the
  delegate backend behaves the same.
- `src/core/config/config.ts` on `KotaConfig.defaultAgentHarness` and
  `src/core/agent-harness/AGENTS.md` match the code: if the doc says "no
  implicit default", then `grep '"claude-agent-sdk"' src/cli.ts src/core/tools/
  src/modules/autonomy/` returns nothing outside the claude adapter module
  and its tests. One source of truth.
- `src/modules/autonomy/AGENTS.md` (and the autonomy workflow subtree
  `AGENTS.md` files where relevant) reflect the new boundary: the autonomy
  fleet inherits harness selection from operator config, not from a module-
  local constant. No stale guidance pointing operators at
  `AUTONOMY_AGENT_HARNESS` as the knob.
