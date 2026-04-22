---
id: task-make-agent-harness-pluggable-beyond-claude-agent-s
title: Make agent harness pluggable beyond claude-agent-sdk
status: backlog
priority: p1
area: core
summary: Allow swapping the agent harness (claude-agent-sdk, codex agent SDK, OpenAI-compatible loops) without preferring one.
created_at: 2026-04-22T03:21:30.589Z
updated_at: 2026-04-22T03:21:30.589Z
---

## Problem

The agent harness is hardcoded to `@anthropic-ai/claude-agent-sdk` in
`src/core/agent-sdk/`. The model layer (`src/modules/model-clients/`) already
supports Anthropic and OpenAI-compatible LLM endpoints, but every interactive,
delegate, and autonomous run still goes through the Claude Agent SDK loop.
That couples KOTA to one harness vendor and blocks running runs on the OpenAI
codex agent SDK or any other harness an operator wants to host.

## Desired Outcome

The agent harness becomes a swappable backend with no preferred default in
core. An operator can configure a session/workflow to run on the
claude-agent-sdk loop, the codex agent SDK loop, or any other supported
harness, and the surrounding tool/skill/session/workflow contracts behave the
same.

## Constraints

- Keep one clear public concept (`agent`/`session`) — do not add a parallel
  harness selection surface beside the existing module/session contracts.
- The harness boundary belongs in core (it touches the session loop), but
  individual harness adapters belong in modules.
- Tool risk gating, the agent commit guard, daemon control guard, and
  guardrails must keep working across every supported harness.
- No backwards-compatibility shim that keeps claude-agent-sdk as an implicit
  default after the boundary lands; selection must be explicit.

## Done When

- The session runtime calls a typed harness protocol instead of
  `claude-agent-sdk` directly; the protocol is documented in
  `src/core/AGENTS.md` (or a closer scoped `AGENTS.md`).
- At least one non-claude-agent-sdk harness adapter ships as a module and is
  exercised by an integration test.
- Operators can pick the harness for a session or workflow through normal
  config, with no hidden fallback to claude-agent-sdk.
- Existing autonomy workflows still pass their integration tests on the
  claude-agent-sdk adapter.
- t3 code (Theo Browne's harness-agnostic coding agent) is added to
  `data/watchlist.yaml` so the explorer keeps pulling inspiration during this
  work.
