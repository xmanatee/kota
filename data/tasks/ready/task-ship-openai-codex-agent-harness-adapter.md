---
id: task-ship-openai-codex-agent-harness-adapter
title: Ship OpenAI Codex agent harness adapter
status: ready
priority: p1
area: architecture
summary: Land a tool-capable agent harness adapter for the OpenAI Codex CLI agent runtime so the daemon can run on Codex through the existing pluggable harness protocol.
created_at: 2026-05-02T18:50:10.163Z
updated_at: 2026-05-02T20:05:51.805Z
---

## Problem

The pluggable `AgentHarness` protocol exists and ships with three adapters
today: `claude-agent-harness` (claude-agent-sdk, tool-capable),
`thin-agent-harness` (single-turn, text-only), and
`openai-tools-agent-harness` (OpenAI-compatible tool loop on top of
`model-clients`). Operators cannot yet point the daemon at the OpenAI
Codex CLI / Codex agent runtime without writing a new adapter from
scratch. Until that adapter exists, "harness-neutral KOTA on top of
Codex" stays aspirational.

## Desired Outcome

KOTA ships a first-class `codex-agent-harness` module that lets an
operator run the full daemon (interactive, delegate, autonomy, repair
loops) on the OpenAI Codex CLI / Codex agent runtime as its own
`src/modules/codex-agent-harness/` adapter that registers through
`registerAgentHarness`, honors every guardrail field on
`AgentHarnessRunOptions`, supports multi-turn so the REPL/delegate paths
work, streams partial output through the adapter writer, and is exercised
by harness-parity scenarios alongside the existing adapters.

## Constraints

- Adapter lives in its own module under `src/modules/`. Do not grow
  `src/core/` with vendor-specific code, and do not wedge Codex into the
  existing OpenAI-compat adapter — Codex is its own agent runtime with
  its own contract.
- Reuse `src/modules/model-clients/` only if Codex's exposed surface is
  truly OpenAI-chat-completions-compatible. If the Codex agent runtime
  ships its own SDK with tool-call shapes the existing OpenAI client
  cannot express, pull in the dedicated SDK and document why.
- Honor `canUseTool`, `disallowedTools`, the agent commit guard, the
  daemon control guard, injection-defense, and risk gating end-to-end.
  Reject unsupported `AgentHarnessRunOptions` loudly, do not silently
  degrade.
- No implicit defaults. Operators select this harness via
  `KotaConfig.defaultAgentHarness` or per-step `harness`.
- Multi-turn must work. `supportsMultiTurn: true` is required.
- Coordinate with `task-neutralize-agent-harness-wire-protocol`: if
  Codex surfaces a primitive that the current neutral wire frame cannot
  express cleanly, flag the protocol gap on that task and route through
  validated `harnessOptions`.

## Done When

- A new module `src/modules/codex-agent-harness/` ships an adapter
  against the OpenAI Codex CLI / Codex agent runtime, registers with
  `registerAgentHarness`, and passes a tool-capable harness-parity
  scenario.
- The adapter has an `AGENTS.md` documenting which providers it covers,
  how guardrails apply inside the loop, and what the multi-turn context
  format is — at conventions level, no per-function inventory.
- `kota harness-parity run` emits paired artifacts under
  `harness-parity/<scenario>/codex/` for at least one shared scenario
  succeeding under this adapter alongside the existing adapters.
- `KotaConfig.defaultAgentHarness` switches the daemon end-to-end onto
  this adapter without code changes; an autonomy workflow integration
  test demonstrates one full repair loop on this adapter (or shares
  the integration evidence with the sibling Vercel/Gemini slices —
  one demo across the three is acceptable).
- A short module-level note records which `model-clients` endpoints
  back the adapter, or which new vendor SDK was pulled in and why the
  existing model client could not be reused.

## Source / Intent

Owner request captured 2026-04-29 in
`data/inbox/make-the-deamon-support-all-harnesses-and-models-and-providers.md`
(captured into the original parent task before promotion):

> Currently it works with claude and anthropic agent-sdk... there are
> beginnings of support for other harnesses... but i want it to cleanly
> support codex and gemini-cli and their versions of agents-sdk as well as
> vercel agents-sdk and others. Take inspiration from "t3 code". basically
> i want yo be able to easily run deamon powered by gemini or codex
> instead of claude code. make sure to research and check all the
> relevant repositories to make sure it all would work perfectly! Also
> investigate the codebase to make sure the abstracts and protocols would
> support it all perfectly!

This task is the Codex slice of the original
`task-ship-codex-gemini-and-vercel-agent-harness-adapter` parent. The
parent was decomposed on 2026-05-02 into three per-vendor tasks because
each adapter requires distinct vendor SDK research, dependency wiring,
adapter implementation, and live parity evidence — a scope that cannot
be honestly completed in a single builder run. The Vercel and Gemini
slices live in the sibling tasks
`task-ship-vercel-ai-sdk-agent-harness-adapter` and
`task-ship-google-gemini-agent-harness-adapter`.

External research the builder must do before designing the adapter:

- OpenAI Codex CLI repo and Codex agent SDK release notes — verify the
  public tool-calling shape, multi-turn context format, streaming
  surface, and guardrail hooks.
- t3 code (Theo Browne) — read the harness-agnostic structure for
  pattern inspiration; do not copy without auditing license and fit.

## Initiative

Harness neutrality: take KOTA from "harness-neutral protocol" to
"harness-neutral runtime in practice" by shipping the adapter operators
actually want to swap in for Codex-powered daemons.

## Acceptance Evidence

- Diff/screenshot of `kota harness-parity run` output listing the
  codex adapter succeeding on a shared scenario alongside the existing
  three, with paired artifacts under
  `.kota/runs/<run-id>/harness-parity/<scenario>/codex/`.
- Integration test or recorded transcript of an autonomy repair loop
  completing under one of the new adapters (Codex/Vercel/Gemini); a
  shared demo across the sibling tasks is acceptable.
- A configuration snippet showing `KotaConfig.defaultAgentHarness` set
  to `codex` with the daemon starting cleanly and the relevant
  provider routes responding.
- The new module directory with `AGENTS.md`, adapter, and focused
  tests committed.
