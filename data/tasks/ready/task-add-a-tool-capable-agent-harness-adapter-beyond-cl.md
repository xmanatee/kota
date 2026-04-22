---
id: task-add-a-tool-capable-agent-harness-adapter-beyond-cl
title: Add a tool-capable agent harness adapter beyond claude-agent-sdk so harness parity is real
status: ready
priority: p2
area: architecture
summary: Ship a second tool-capable AgentHarness adapter (on top of the model-clients OpenAI-compatible loop) so the pluggable-harness claim has more than one consumer with tools, and harness-parity evidence can cover a non-Anthropic tool-using path.
created_at: 2026-04-22T23:10:24.740Z
updated_at: 2026-04-22T23:10:24.740Z
---

## Problem

`src/core/agent-harness/` declares that the harness boundary is
harness-neutral and that the core never privileges `claude-agent-sdk`. In
practice only `claude-agent-sdk` is a tool-capable adapter today: the
`thin-agent-harness` module is deliberately single-turn, text-only, and
rejects `canUseTool`, `mcpServers`, `allowedTools`, and `disallowedTools` at
the boundary (see `src/modules/thin-agent-harness/AGENTS.md`). Every path
that exercises tools — workflow agent steps, repair loops, delegate,
interactive sessions that call tools — therefore still depends on one
vendor harness.

The harness-parity task already names this gap: the paired artifact it
wants to capture under `.kota/runs/<run-id>/harness-parity/` can only show
one tool-capable harness succeeding and one text-only harness emitting a
proposal patch. Without a second tool-capable consumer, "general-purpose
coding agent across pluggable harnesses" stays aspirational, and a change
that regresses the protocol for a second consumer has no way to surface.

## Desired Outcome

A second `AgentHarness` adapter ships as its own module and registers with
the core registry. It drives a tool-calling loop against an
OpenAI-compatible model via the existing `model-clients` registry (the
OpenAI client already translates tools / function-calls and handles
streaming), applies every guardrail the harness protocol demands
(`canUseTool`, risk gating, commit guard, daemon control guard,
injection-defense middleware, tool allow/deny lists), and supports
multi-turn so the REPL, delegate, and workflow paths can drive it.
Operators can pick this adapter via `KotaConfig.defaultAgentHarness` or a
per-step `harness` selection, and `kota harness-parity run` emits a
meaningful paired artifact with both claude-agent-sdk and this new
adapter completing the scenario under their own tool loops.

## Constraints

- Live in a new module under `src/modules/<name>-agent-harness/` (or a
  similarly descriptive module name). Do not grow `src/core/` with
  another adapter, and do not wedge the loop into `thin-agent-harness`
  — the thin harness's text-only contract is explicit and load-bearing.
- Register through `registerAgentHarness` on module load, mirroring the
  `claude-agent-harness` and `thin-agent-harness` pattern. No implicit
  default behavior; operators still pick the harness via config or flag.
- Build on `src/modules/model-clients/` rather than pulling in a second
  SDK. The OpenAI client already supports `tools` and `tool_calls`; reuse
  it. If a different LLM library is genuinely needed, document why before
  adding a dependency.
- Honor every guardrail field in `AgentHarnessRunOptions`. Reject
  unsupported options loudly at the boundary rather than silently
  ignoring them, in line with the `agent-harness` protocol rule.
- `supportsMultiTurn` must be `true` so the harness-neutral REPL
  (`#core/repl/harness-repl`) can drive it without downgrading. The loop
  should take prior-turn context via `AgentHarnessRunOptions` the same
  way claude-agent-sdk does.
- Stream partial text through the adapter's optional `writer` so the
  CLI transport (`#core/loop/transport.ts`) and rendering module keep
  showing live output regardless of which harness runs.
- No test-only branches in production code. Integration tests should hit
  a stubbed OpenAI-compatible endpoint (the existing model-clients test
  harness already does this); do not add a runtime flag that bypasses
  tool loops.
- Do not re-implement guardrails. Route `canUseTool` through the same
  shape the SDK adapter uses; treat injection-defense as a layer above
  the harness, not inside it.

## Done When

- A new module ships under `src/modules/<name>-agent-harness/` with
  `adapter.ts`, `index.ts`, an `AGENTS.md`, and focused tests. Its name
  clearly signals that it is a tool-capable OpenAI-compatible loop, not
  an alias for `thin`.
- The adapter registers with `registerAgentHarness` on module load,
  resolves through `resolveAgentHarness`, and declares
  `supportsMultiTurn: true`.
- A tool-calling loop runs against a stubbed OpenAI-compatible endpoint
  in tests: at least one success case with a tool call dispatched and a
  follow-up turn composing the final response, one guardrail-denial case
  (denied tool stops the loop cleanly), and one protocol-error case
  (malformed `tool_call` from the model fails loudly rather than being
  coerced).
- `AgentHarnessRunOptions` guardrail fields are honored end-to-end: a
  `canUseTool` denial, a `disallowedTools` entry, and a commit guard
  denial each short-circuit the loop with the expected envelope.
- The harness is selectable via `KotaConfig.defaultAgentHarness` and
  per-step `harness`, and `kota run -i` drops into the multi-turn REPL
  against it without the REPL refusing to launch.
- `src/modules/harness-parity/` treats the new adapter as a registered
  harness: `kota harness-parity run` emits a paired artifact under
  `harness-parity/<scenario>/<adapter>/` with prompt, trace, diff, and
  verification just like the SDK path. The `fix-arithmetic-bug`
  scenario (or an equivalent) succeeds under this adapter.
- The module's `AGENTS.md` documents which OpenAI-compatible providers
  the adapter supports, how guardrails are applied inside the loop, and
  what the multi-turn context format looks like, at the conventions
  level — no per-function inventory.

## Plan

- Start from the thin adapter as a shape reference and the SDK adapter
  as a behavior reference. Write the new adapter as a small state
  machine: request → iterate tool calls (dispatch through `canUseTool`
  and the tool runner) → append tool results to context → next request
  → stop on assistant text with no tool calls.
- Reuse the SDK adapter's permission normalization and guard wiring
  pattern where it is not SDK-specific; lift shared helpers into the
  `agent-harness` protocol directory only if they are genuinely
  cross-adapter.
- Hook the adapter into the harness-parity runner last, and extend a
  fixture if the existing `fix-arithmetic-bug` scenario exercises an
  SDK-only surface.
