---
id: task-ship-codex-gemini-and-vercel-agent-harness-adapter
title: Ship Codex Gemini and Vercel agent harness adapters
status: dropped
priority: p1
area: architecture
summary: Land tool-capable agent harness adapters for Codex CLI, Gemini CLI, and Vercel AI agent SDK so the daemon can be powered by non-Claude agent runtimes through the existing pluggable harness protocol.
created_at: 2026-04-28T23:56:36.787Z
updated_at: 2026-05-02T18:52:29.123Z
---

## Drop Reason

Decomposed on 2026-05-02 into three per-vendor implementation tasks
because each adapter requires distinct vendor SDK research, dependency
wiring, adapter implementation, and live parity evidence — a scope that
cannot be honestly completed in a single builder run. The owner intent
is preserved verbatim in each child task. The replacements live under
backlog:

- `task-ship-vercel-ai-sdk-agent-harness-adapter`
- `task-ship-openai-codex-agent-harness-adapter`
- `task-ship-google-gemini-agent-harness-adapter`

The original problem and outcome statements below are kept as the
authoritative source for why this work matters; the child tasks slice
the deliverables across vendors so each can be picked up independently.

## Problem

The pluggable `AgentHarness` protocol exists and ships with three adapters
today: `claude-agent-harness` (claude-agent-sdk, tool-capable), `thin-agent-
harness` (single-turn, text-only), and `openai-tools-agent-harness` (OpenAI-
compatible tool loop on top of `model-clients`). Operators cannot yet point
the daemon at the OpenAI Codex CLI agent SDK, the Google Gemini CLI agent
runtime, or the Vercel AI agent SDK without writing a new adapter from
scratch. Until those adapters exist, "harness-neutral KOTA" stays
aspirational for the runtimes the owner actually wants to swap in.

## Desired Outcome

KOTA ships first-class harness modules that let an operator run the full
daemon (interactive, delegate, autonomy, repair loops) on:

- the OpenAI Codex CLI / Codex agent runtime,
- the Google Gemini CLI / Gemini agent runtime,
- the Vercel AI agent SDK,

each as its own `src/modules/<vendor>-agent-harness/` adapter that
registers through `registerAgentHarness`, honors every guardrail field on
`AgentHarnessRunOptions`, supports multi-turn so the REPL/delegate paths
work, streams partial output through the adapter writer, and is exercised
by harness-parity scenarios alongside the existing adapters.

## Constraints

- Each adapter lives in its own module under `src/modules/`. Do not grow
  `src/core/` with vendor-specific code, and do not wedge new vendors into
  existing adapters; they are vendor-specific by name and contract.
- Reuse `src/modules/model-clients/` where the vendor exposes a chat
  completions API; only add new vendor SDK dependencies when no existing
  client covers the surface (e.g. tool-call streaming shapes the existing
  client cannot express).
- Honor `canUseTool`, `disallowedTools`, the agent commit guard, the
  daemon control guard, injection-defense, and risk gating end-to-end.
  Reject unsupported `AgentHarnessRunOptions` loudly, do not silently
  degrade.
- No implicit defaults. Operators select a harness via
  `KotaConfig.defaultAgentHarness` or per-step `harness`; nothing should
  fall back to claude-agent-sdk after these adapters land.
- Multi-turn must work. `supportsMultiTurn: true` is required so the
  harness-neutral REPL and delegate steps can drive each adapter without
  downgrading.
- Coordinate with `task-neutralize-agent-harness-wire-protocol`: if any
  vendor surfaces a primitive that the current neutral wire frame cannot
  express cleanly, do not paper over it with a Claude-shaped field; flag
  the protocol gap on that task and route through validated
  `harnessOptions`.
- Coordinate with `task-add-built-cli-daemon-smoke-coverage-for-provider-b`:
  the new harness modules should plug into the same provider-readiness
  smoke once it lands.

## Done When

- A new module `src/modules/codex-agent-harness/` (or similarly named)
  ships an adapter against the OpenAI Codex CLI / agent runtime, registers
  with `registerAgentHarness`, and passes a tool-capable harness-parity
  scenario.
- A new module `src/modules/gemini-agent-harness/` ships an adapter
  against the Google Gemini CLI / agent runtime with the same parity.
- A new module `src/modules/vercel-agent-harness/` ships an adapter
  against the Vercel AI agent SDK with the same parity.
- Each adapter has an `AGENTS.md` documenting which providers it covers,
  how guardrails apply inside the loop, and what the multi-turn context
  format is — at conventions level, no per-function inventory.
- `kota harness-parity run` emits paired artifacts under
  `harness-parity/<scenario>/<adapter>/` for at least one shared scenario
  (e.g. `fix-arithmetic-bug`) succeeding under all three new adapters in
  addition to the existing three.
- `KotaConfig.defaultAgentHarness` switches the daemon end-to-end onto
  each new adapter without code changes; an autonomy workflow integration
  test demonstrates one full repair loop on at least one of the new
  adapters.
- A short module-level note records which existing `model-clients`
  endpoints back each adapter, or which new vendor SDK was pulled in and
  why the existing model client could not be reused.

## Source / Intent

Owner request captured 2026-04-29 in
`data/inbox/make-the-deamon-support-all-harnesses-and-models-and-providers.md`:

> Currently it works with claude and anthropic agent-sdk... there are
> beginnings of support for other harnesses... but i want it to cleanly
> support codex and gemini-cli and their versions of agents-sdk as well as
> vercel agents-sdk and others. Take inspiration from "t3 code". basically
> i want yo be able to easily run deamon powered by gemini or codex
> instead of claude code. make sure to research and check all the
> relevant repositories to make sure it all would work perfectly! Also
> investigate the codebase to make sure the abstracts and protocols would
> support it all perfectly!

Repo state on 2026-04-29: `src/modules/` contains `claude-agent-harness`,
`openai-tools-agent-harness`, and `thin-agent-harness`; no codex/gemini/
vercel adapter exists. The harness boundary itself was completed by
`task-make-agent-harness-pluggable-beyond-claude-agent-s` and
`task-add-a-tool-capable-agent-harness-adapter-beyond-cl` (both done).
`task-neutralize-agent-harness-wire-protocol` is the open follow-up that
finishes wire-frame neutrality. `data/watchlist.yaml` already tracks
`t3.chat` / Theo Browne's harness-agnostic coding agent as inspiration.

External research the builder must do before designing each adapter:

- OpenAI Codex CLI repo and agent SDK release notes — verify the public
  tool-calling shape, multi-turn context format, streaming surface, and
  guardrail hooks.
- Google Gemini CLI repo and agent runtime — verify the same surface
  and how function calling/tools are exposed.
- Vercel AI SDK agent / `streamText` / tool-call protocol docs and
  current package layout.
- t3 code (Theo Browne) — read the harness-agnostic structure for
  pattern inspiration; do not copy without auditing license and fit.

## Initiative

Harness neutrality: take KOTA from "harness-neutral protocol" to
"harness-neutral runtime in practice" by shipping the adapters operators
actually want to swap in.

## Acceptance Evidence

- Diff/screenshot of `kota harness-parity run` output listing all
  adapters (existing three plus codex/gemini/vercel) succeeding on a
  shared scenario, with paired artifacts under
  `.kota/runs/<run-id>/harness-parity/<scenario>/<adapter>/`.
- Integration test or recorded transcript of an autonomy repair loop
  completing under one of the new adapters.
- A configuration snippet showing `KotaConfig.defaultAgentHarness` set
  to each new adapter with the daemon starting cleanly and the relevant
  provider routes responding.
- The three new module directories with `AGENTS.md`, adapter, and
  focused tests committed.
