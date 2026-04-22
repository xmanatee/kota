---
id: task-make-hook-and-plugin-surfaces-behave-identically-a
title: Make hook and plugin surfaces behave identically across every registered agent harness
status: done
priority: p2
area: architecture
summary: Define a harness-neutral hook/plugin protocol so pre-send, post-tool, and cleanup hooks fire consistently across every registered agent harness.
created_at: 2026-04-22T20:27:18.259Z
updated_at: 2026-04-22T21:03:15.968Z
---

## Problem

KOTA already has hook primitives (`registerPreSendHook` in `src/core/loop/`)
and a module protocol, but they are wired only into the classic
`AgentSession` loop. When a caller runs through an `AgentHarness` adapter —
claude-agent-sdk, thin, or any future codex / OpenAI-compat loop — those
hooks do not fire. Module-owned capabilities such as architect mode that
depend on pre-send hooks therefore behave differently depending on which
harness the operator selects. Plugins and skills surface through the
commands module, but there is no harness-neutral contract that guarantees
every adapter sees them at the same lifecycle points.

## Desired Outcome

One harness-neutral hook/plugin protocol that every registered adapter
honors. Pre-send hooks (and any other lifecycle hooks that make sense at the
adapter boundary — pre-tool, post-tool, cleanup) fire at the same points for
every adapter, with typed payloads and clear skip semantics when an adapter
truly cannot host a given hook. Skills and commands-module contributions
work identically regardless of the selected harness.

## Constraints

- Reuse the existing hook registries and module protocol. Do not fork a
  second hook surface per harness.
- Adapters that genuinely cannot host a given hook (e.g. text-only `thin`
  with no tool loop has no pre-tool hook) must reject the attempt loudly at
  load time, not silently swallow it at runtime. Same rule as the existing
  tool-option validation in `thin-agent-harness`.
- Keep the `AgentHarness` protocol small. New hook types should be shared
  across adapters, not harness-specific.
- Tests must exercise at least two harness adapters to prove parity.

## Done When

- A harness-neutral hook/plugin protocol is documented in
  `src/core/agent-harness/AGENTS.md` (or an equivalent narrow location) and
  exposed through the `AgentHarness` contract.
- Every registered adapter either applies each documented hook or rejects
  it at load time with a clear error.
- Skills and commands-module contributions surface identically across at
  least two harness adapters, covered by tests.
- Existing `registerPreSendHook` callers continue to work unchanged, or are
  migrated to the neutral protocol with no behavioral regression.
