---
id: task-neutralize-agent-harness-wire-protocol
title: Neutralize agent harness wire protocol
status: done
priority: p2
area: architecture
summary: Finish removing Claude-shaped assumptions from the core AgentHarness protocol by defining KOTA-native message, permission, option, and raw-adapter envelopes.
created_at: 2026-04-28T22:24:00.000Z
updated_at: 2026-04-29T07:51:27.892Z
---

## Problem

The harness boundary is much better than it used to be, and tests prevent
direct Anthropic imports in core. But `src/core/agent-harness/types.ts` still
documents that neutral wire frames originated with the Claude Agent SDK, and
core types still expose Claude-shaped concepts such as `permissionMode`,
`settingSources`, snake/camel session id variants, and permission decision
literals that mirror the SDK.

This is a subtle protocol bias: future non-Claude adapters have to translate
into a shape that is nominally neutral but historically Claude-shaped.

## Desired Outcome

The core agent harness protocol becomes KOTA-native:

- KOTA-owned message envelopes with a small discriminated union for assistant
  text, tool call, tool result, status, result, and raw adapter event.
- KOTA-owned permission/autonomy concepts that adapters map to native SDK
  options.
- Harness-specific options remain under validated `harnessOptions`, but the
  neutral `AgentHarnessRunOptions` stops carrying provider-specific fields.
- Raw provider frames are preserved only under an explicit `raw` field or
  adapter-owned trace artifact, never as core protocol fields.
- Existing Claude and OpenAI-tool adapters still pass parity tests.

## Constraints

- Do not regress guardrails, owner-question support, streaming output, abort
  propagation, or MCP server handling.
- Preserve the existing `harnessOptions` validation pattern for truly
  adapter-specific knobs.
- Coordinate with existing completed work on moving Claude-shaped step fields;
  this task finishes the remaining wire-protocol cleanup rather than repeating
  that migration.
- Keep adapter boundaries loud: unsupported options must still reject, not
  silently degrade.

## Done When

- Core harness types no longer describe themselves as Claude-originated or
  mirror SDK literals as the neutral contract.
- Provider-specific fields are either removed from neutral options or moved
  behind adapter-specific validated options.
- Cross-harness parity tests for rails, abort propagation, MCP servers, and any
  existing harness fixtures remain green.
- A guard test prevents new SDK-shaped fields from being added to core harness
  types without an adapter-owned translation.

## Source / Intent

2026-04-28 review found the current harness protocol is directionally correct
but still leaks Claude SDK shape through neutral core types. Existing completed
tasks show this area has been improved before; the remaining issue is the core
wire-frame itself.

External comparison:

- OpenAI Agents SDK treats agents, handoffs, guardrails, and tracing as named
  concepts.
- Claude Code exposes subagents, hooks, permissions, and settings as native
  concepts.
- KOTA should expose KOTA concepts in core and map provider concepts at adapter
  seams.

## Initiative

Harness neutrality: keep KOTA a real multi-harness runtime rather than a
Claude-shaped runtime with alternate adapters.

## Acceptance Evidence

- Type diff or protocol summary showing removed/renamed SDK-shaped neutral
  fields.
- Cross-harness parity suite green after migration.
- Guard test demonstrating a new provider-specific neutral field is rejected
  unless it is routed through adapter-owned options.

