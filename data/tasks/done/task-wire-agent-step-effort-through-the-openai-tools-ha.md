---
id: task-wire-agent-step-effort-through-the-openai-tools-ha
title: Wire agent-step effort through the openai-tools harness instead of silently dropping it
status: done
priority: p2
area: architecture
summary: Pipe effort through the openai-tools adapter to reasoning-capable providers so autonomy steps running on openai-tools do not silently drop step.effort.
created_at: 2026-04-23T01:04:50.337Z
updated_at: 2026-04-23T01:20:37.851Z
---

## Problem

`src/modules/openai-tools-agent-harness/adapter.ts` accepts `effort` on
`AgentHarnessRunOptions` but never forwards it to the underlying
`ModelClient.messages.stream` call. `src/modules/openai-tools-agent-harness/AGENTS.md`
documents this explicitly: "`effort` is accepted but is currently a no-op for
OpenAI-compatible providers."

Every autonomy agent step declares `effort` — the workflow validator already
requires it, and current autonomy defaults are `xhigh`. When an operator sets
`KotaConfig.defaultAgentHarness: "openai-tools"` against a reasoning-capable
endpoint (OpenAI `o1/o3/o4`, Anthropic via an OpenAI-compatible wrapper that
honors `thinking`, DeepSeek-Reasoner, Qwen-with-thinking, Ollama presets that
expose a thinking budget, etc.), `effort` is silently dropped. The step runs
at whatever default reasoning the provider applies, not at the posture the
workflow declared — a hidden quality shift the operator cannot see in the
trace, the run artifact, or the harness-parity diff.

This is the exact silent-coercion the repo's root `AGENTS.md` forbids ("No
silent fallbacks", "Protocols, types, and function signatures must be strict")
and the harness protocol's own rule ("A harness must not silently coerce
unsupported options"). It also undercuts the "general-purpose coding agent
across pluggable harnesses" claim: switching harness changes the effective
reasoning budget of every autonomous step without warning.

`src/core/model/model-client.ts` already accepts `thinking?: ThinkingConfigParam`
on the stream call (used by `claude-agent-sdk`), so the Anthropic-via-OpenAI-
compatible path has a target today. OpenAI-o-series reasoning-effort is not
exposed on `ModelClient` yet and is the other half of this gap.

## Desired Outcome

The `openai-tools` adapter honors `AgentHarnessRunOptions.effort` when the
resolved ModelClient can host a reasoning control, and fails loudly (with a
message naming `claude-agent-sdk`) when it cannot. There is exactly one path
through the adapter — no hidden fallback to the default reasoning budget.
`openai-tools-agent-harness/AGENTS.md` is updated so the passthrough is the
documented behavior and the "currently a no-op" line is gone.

## Constraints

- Do not add a parallel reasoning-control surface. Extend
  `ModelClient.messages.stream` options (or a sibling typed option on
  `createModelClient`) to declare a reasoning-control mapping per preset.
  Presets that already accept `thinking` keep accepting it; presets that need
  OpenAI-o-series `reasoning.effort` / `reasoning: { effort }` get that field
  added at the wire boundary — not a new `openai-tools`-local abstraction.
- Map the KOTA `AgentEffort` enum to each reasoning surface in one place
  (`model-clients`), not per-call in the adapter. The adapter forwards
  `effort` verbatim; the preset owns the translation. This keeps provider
  specifics out of the harness.
- No silent downgrade. If the resolved preset has no reasoning mapping and
  `effort` is anything other than a declared "default/no reasoning" value,
  the adapter must throw loudly naming the affected preset and pointing at
  `claude-agent-sdk`. Matches the rejection posture for `mcpServers`,
  `persistSession`, etc.
- Do not add a dual path. Either every `openai-tools` run honors effort or
  throws — no feature flag, no "permissive mode".
- Preserve the existing rejection list. `thinkingEnabled: true` /
  `thinkingBudget` remain rejected: this task wires the `effort` contract,
  not the claude-specific `thinking` toggle. If a future preset exposes
  Anthropic-style thinking through an OpenAI-compatible endpoint, the
  mapping from `effort` handles it — the claude-specific toggle still
  belongs to `claude-agent-sdk`.
- Keep the test boundary stubbed. `adapter.integration.test.ts` (or a new
  focused test) must verify passthrough, rejection, and preset coverage
  through a stubbed ModelClient; no live endpoint, no real API budget.
- Do not touch `claude-agent-sdk` or `thin-agent-harness` behavior beyond
  what is strictly required by a shared type change. The thin adapter
  correctly ignores effort — it has no reasoning loop.
- Do not add a hard capability-matrix registry in `src/core/agent-harness/`
  just for this. The preset surface in `model-clients` is the correct
  owner; the harness registry only registers adapters.

## Done When

- `src/modules/openai-tools-agent-harness/adapter.ts` forwards `effort` to
  the ModelClient stream call such that the resolved reasoning control is
  observable on the wire (stubbed in tests, real on live endpoints).
- `src/core/model/model-client.ts` exposes a typed reasoning-control field
  alongside `thinking`, and the preset registry maps `AgentEffort` to the
  correct wire shape per preset. At minimum one preset covers the
  Anthropic-via-OpenAI-compatible path (`thinking`) and one covers the
  OpenAI-o-series path (`reasoning.effort` or the current provider
  convention).
- `AgentEffort` values that cannot be mapped for a given preset cause the
  adapter to throw loudly at the boundary, matching the existing
  rejection-list pattern. A focused test exercises this path.
- `src/modules/openai-tools-agent-harness/adapter.integration.test.ts` (or
  a sibling test) verifies: passthrough for a reasoning-capable preset,
  loud rejection for a preset without a reasoning mapping when effort is
  non-default, and the existing claude-specific rejection list remains
  intact. No test depends on a real endpoint.
- `src/modules/openai-tools-agent-harness/AGENTS.md` documents the
  passthrough contract at convention level (what effort does, when it is
  rejected, which presets cover which reasoning surface). The current
  "currently a no-op" line is removed.
- `src/modules/harness-parity/` scenario output (`run-meta.json` or
  `trace-summary.md`) surfaces the resolved effort alongside the already-
  recorded model and harness, so an operator comparing paired artifacts
  can see the reasoning posture actually used under each adapter. The
  field name is consistent with the per-step agent artifact that already
  records `harness` and `model`.
- No separate "capability matrix" module is introduced. All capability
  advertisement lives on the existing preset + adapter surfaces.
