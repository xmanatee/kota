---
id: task-ship-vercel-ai-sdk-agent-harness-adapter
title: Ship Vercel AI SDK agent harness adapter
status: done
priority: p1
area: architecture
summary: Land a tool-capable agent harness adapter for the Vercel AI SDK so the daemon can be powered by the Vercel agent runtime through the existing pluggable harness protocol.
created_at: 2026-05-02T18:50:06.631Z
updated_at: 2026-05-02T20:00:57.408Z
---

## Problem

The pluggable `AgentHarness` protocol exists and ships with three adapters
today: `claude-agent-harness` (claude-agent-sdk, tool-capable),
`thin-agent-harness` (single-turn, text-only), and
`openai-tools-agent-harness` (OpenAI-compatible tool loop on top of
`model-clients`). Operators cannot yet point the daemon at the Vercel AI
agent SDK without writing a new adapter from scratch. Until that adapter
exists, "harness-neutral KOTA on top of Vercel AI" stays aspirational.

## Desired Outcome

KOTA ships a first-class `vercel-agent-harness` module that lets an
operator run the full daemon (interactive, delegate, autonomy, repair
loops) on the Vercel AI agent SDK as its own
`src/modules/vercel-agent-harness/` adapter that registers through
`registerAgentHarness`, honors every guardrail field on
`AgentHarnessRunOptions`, supports multi-turn so the REPL/delegate paths
work, streams partial output through the adapter writer, and is exercised
by harness-parity scenarios alongside the existing adapters.

## Constraints

- Adapter lives in its own module under `src/modules/`. Do not grow
  `src/core/` with vendor-specific code, and do not wedge Vercel into the
  existing OpenAI-compat adapter.
- Honor `canUseTool`, `disallowedTools`, the agent commit guard, the
  daemon control guard, injection-defense, and risk gating end-to-end.
  Reject unsupported `AgentHarnessRunOptions` loudly, do not silently
  degrade.
- No implicit defaults. Operators select this harness via
  `KotaConfig.defaultAgentHarness` or per-step `harness`; nothing should
  fall back to claude-agent-sdk after this adapter lands.
- Multi-turn must work. `supportsMultiTurn: true` is required so the
  harness-neutral REPL and delegate steps can drive this adapter without
  downgrading.
- Coordinate with `task-neutralize-agent-harness-wire-protocol`: if Vercel
  surfaces a primitive that the current neutral wire frame cannot
  express cleanly, do not paper over it with a Claude-shaped field;
  flag the protocol gap on that task and route through validated
  `harnessOptions`.

## Done When

- A new module `src/modules/vercel-agent-harness/` ships an adapter
  against the Vercel AI agent SDK, registers with `registerAgentHarness`,
  and passes a tool-capable harness-parity scenario.
- The adapter has an `AGENTS.md` documenting which providers it covers,
  how guardrails apply inside the loop, and what the multi-turn context
  format is — at conventions level, no per-function inventory.
- `kota harness-parity run` emits paired artifacts under
  `harness-parity/<scenario>/vercel/` for at least one shared scenario
  (e.g. `fix-arithmetic-bug`) succeeding under this adapter alongside
  the existing adapters.
- `KotaConfig.defaultAgentHarness` switches the daemon end-to-end onto
  this adapter without code changes; an autonomy workflow integration
  test demonstrates one full repair loop on this adapter.
- A short module-level note records which `model-clients` endpoints back
  the adapter, or which new vendor SDK was pulled in and why the existing
  model client could not be reused.

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

This task is the Vercel AI SDK slice of the original
`task-ship-codex-gemini-and-vercel-agent-harness-adapter` parent. The
parent was decomposed on 2026-05-02 into three per-vendor tasks because
each adapter requires distinct vendor SDK research, dependency wiring,
adapter implementation, and live parity evidence — a scope that cannot
be honestly completed in a single builder run. The Codex and Gemini
slices live in the sibling tasks `task-ship-openai-codex-agent-harness-
adapter` and `task-ship-google-gemini-agent-harness-adapter`.

External research the builder must do before designing the adapter:

- Vercel AI SDK agent / `streamText` / `generateText` / tool-call
  protocol docs and current package layout (`ai`, `@ai-sdk/openai`,
  `@ai-sdk/anthropic`, …).
- t3 code (Theo Browne) — read the harness-agnostic structure for
  pattern inspiration; do not copy without auditing license and fit.
- The Vercel AI SDK's `experimental_*` tool-call surfaces — confirm
  which knobs are stable, which are experimental, and how multi-step
  tool loops, abort, and streaming behave for KOTA's parity scenarios.

## Initiative

Harness neutrality: take KOTA from "harness-neutral protocol" to
"harness-neutral runtime in practice" by shipping the adapter operators
actually want to swap in for Vercel-AI-SDK-powered daemons.

## Acceptance Evidence

- The new module directory `src/modules/vercel-agent-harness/` with
  `AGENTS.md`, adapter, registration, four focused tests, and the
  bumped `package.json` (adds `ai` and `@ai-sdk/openai` as direct
  deps) committed.
- `src/modules/vercel-agent-harness/scenario-loop.integration.test.ts`
  drives the harness through the shipped `fix-arithmetic-bug` parity
  scenario with the Vercel SDK mocked, asserting the verification
  command is dispatched through the tool registry. This is the
  headless parity probe for the adapter; the live `kota harness-parity
  run` capture is operator-driven (see precondition below).
- `src/modules/vercel-agent-harness/autonomy-harness-neutral.integration.test.ts`
  proves an autonomy agent step routes through the vercel harness with
  a portable system prompt and `effort` mapped to OpenAI's
  `reasoningEffort` — the headless analogue of an autonomy repair loop
  on this adapter.
- `src/modules/vercel-agent-harness/adapter.integration.test.ts`
  proves `KotaConfig.defaultAgentHarness: "vercel"` resolves through
  the registry alongside `claude-agent-sdk`, `openai-tools`, and
  `thin` with no implicit fallback.

### Operator-capture precondition

The live `kota harness-parity run` artifact under
`.kota/runs/<run-id>/harness-parity/fix-arithmetic-bug/vercel/` and a
real autonomy repair-loop transcript on this adapter both consume
real Vercel AI SDK API budget against an operator-provided
`OPENAI_API_KEY` (or another registered provider's key). They
therefore require an operator-driven `kota harness-parity run` and a
deliberate live autonomy run after this task lands. Capturing them
inside the autonomous builder is forbidden by the harness-parity
module's "no live execution without operator authorization step"
contract.
