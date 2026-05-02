---
id: task-ship-google-gemini-agent-harness-adapter
title: Ship Google Gemini agent harness adapter
status: done
priority: p1
area: architecture
summary: Land a tool-capable agent harness adapter for the Google Gemini CLI agent runtime so the daemon can run on Gemini through the existing pluggable harness protocol.
created_at: 2026-05-02T18:50:13.755Z
updated_at: 2026-05-02T20:19:51.552Z
---

## Problem

The pluggable `AgentHarness` protocol exists and ships with three adapters
today: `claude-agent-harness` (claude-agent-sdk, tool-capable),
`thin-agent-harness` (single-turn, text-only), and
`openai-tools-agent-harness` (OpenAI-compatible tool loop on top of
`model-clients`). Operators cannot yet point the daemon at the Google
Gemini CLI / Gemini agent runtime without writing a new adapter from
scratch. Until that adapter exists, "harness-neutral KOTA on top of
Gemini" stays aspirational.

## Desired Outcome

KOTA ships a first-class `gemini-agent-harness` module that lets an
operator run the full daemon (interactive, delegate, autonomy, repair
loops) on the Google Gemini CLI / Gemini agent runtime as its own
`src/modules/gemini-agent-harness/` adapter that registers through
`registerAgentHarness`, honors every guardrail field on
`AgentHarnessRunOptions`, supports multi-turn so the REPL/delegate paths
work, streams partial output through the adapter writer, and is exercised
by harness-parity scenarios alongside the existing adapters.

## Constraints

- Adapter lives in its own module under `src/modules/`. Do not grow
  `src/core/` with vendor-specific code, and do not wedge Gemini into
  the existing OpenAI-compat adapter — Gemini's `functionDeclarations`
  tool shape is its own contract.
- Reuse `src/modules/model-clients/` only if Gemini exposes a chat
  completions API the existing OpenAI client genuinely covers. Otherwise
  pull in the dedicated Gemini SDK (`@google/genai` or
  `@google/gemini-cli-core`) and document why.
- Honor `canUseTool`, `disallowedTools`, the agent commit guard, the
  daemon control guard, injection-defense, and risk gating end-to-end.
  Reject unsupported `AgentHarnessRunOptions` loudly, do not silently
  degrade.
- No implicit defaults. Operators select this harness via
  `KotaConfig.defaultAgentHarness` or per-step `harness`.
- Multi-turn must work. `supportsMultiTurn: true` is required.
- Coordinate with `task-neutralize-agent-harness-wire-protocol`: if
  Gemini surfaces a primitive that the current neutral wire frame
  cannot express cleanly, flag the protocol gap on that task and route
  through validated `harnessOptions`.

## Done When

- A new module `src/modules/gemini-agent-harness/` ships an adapter
  against the Google Gemini CLI / Gemini agent runtime, registers with
  `registerAgentHarness`, and passes a tool-capable harness-parity
  scenario.
- The adapter has an `AGENTS.md` documenting which providers it covers,
  how guardrails apply inside the loop (Gemini's
  `functionDeclarations` translation included), and what the
  multi-turn context format is — at conventions level, no per-function
  inventory.
- `kota harness-parity run` emits paired artifacts under
  `harness-parity/<scenario>/gemini/` for at least one shared scenario
  succeeding under this adapter alongside the existing adapters.
- `KotaConfig.defaultAgentHarness` switches the daemon end-to-end onto
  this adapter without code changes; an autonomy workflow integration
  test demonstrates one full repair loop on this adapter (or shares
  the integration evidence with the sibling Vercel/Codex slices —
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

This task is the Gemini slice of the original
`task-ship-codex-gemini-and-vercel-agent-harness-adapter` parent. The
parent was decomposed on 2026-05-02 into three per-vendor tasks because
each adapter requires distinct vendor SDK research, dependency wiring,
adapter implementation, and live parity evidence — a scope that cannot
be honestly completed in a single builder run. The Codex and Vercel
slices live in the sibling tasks
`task-ship-openai-codex-agent-harness-adapter` and
`task-ship-vercel-ai-sdk-agent-harness-adapter`.

External research the builder must do before designing the adapter:

- Google Gemini CLI repo and Gemini agent runtime — verify the public
  tool-calling shape (`functionDeclarations`), multi-turn context
  format, streaming surface, and guardrail hooks.
- t3 code (Theo Browne) — read the harness-agnostic structure for
  pattern inspiration; do not copy without auditing license and fit.

## Initiative

Harness neutrality: take KOTA from "harness-neutral protocol" to
"harness-neutral runtime in practice" by shipping the adapter operators
actually want to swap in for Gemini-powered daemons.

## Acceptance Evidence

- Diff/screenshot of `kota harness-parity run` output listing the
  gemini adapter succeeding on a shared scenario alongside the existing
  three, with paired artifacts under
  `.kota/runs/<run-id>/harness-parity/<scenario>/gemini/`.
- Integration test or recorded transcript of an autonomy repair loop
  completing under one of the new adapters (Codex/Vercel/Gemini); a
  shared demo across the sibling tasks is acceptable.
- A configuration snippet showing `KotaConfig.defaultAgentHarness` set
  to `gemini` with the daemon starting cleanly and the relevant
  provider routes responding.
- The new module directory with `AGENTS.md`, adapter, and focused
  tests committed.
