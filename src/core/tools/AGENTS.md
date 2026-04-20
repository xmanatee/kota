# Tools

This directory contains tool runtime infrastructure and the core-hosted tool
implementations that are true runtime primitives.

## Boundary

Core tools stay here only when they are part of the agent/session loop,
guardrails, daemon coordination, or module lifecycle — not general-purpose
conveniences. New capabilities should prefer module-owned tools.

## Core tools and rationale

- `agent_status` — Runtime introspection of tools, modules, providers, groups.
- `approval` — Guardrails: review/resolve queued tool calls from the daemon approval queue.
- `ask_user` — Session loop: interactive terminal I/O.
- `confirm` — Session coordination: human approval for high-stakes actions.
- `delegate` — Agent/session loop: sub-agent spawning.
- `checkpoint` — Session management: track and undo file changes within a session.
- `todo` — Session state: provider-backed task tracking injected into the system prompt via context.
- `custom_tool` — Tool extensibility: bidirectional coupling with the core registry via `initCustomToolRegistry`.
- `module_factory` — Module lifecycle: `addLoadedModule`/`resetModuleFactory` called from loop-init.

## Runtime infrastructure

- `tool-groups`, `tool-middleware`, `tool-runner`, `tool-telemetry`, `tool-result`, `tool-adapters`, `tool-adapter-types`, `tool-adapters-zod` — tool execution pipeline.
- `guardrails`, `guardrails-classify`, `audit-store` — risk assessment and audit storage.
- `repl-session` — shared REPL sessions used by custom-tool handlers and the execution module.
- `code-wrappers` — REPL wrapper scripts and shared constants for core tools and the execution module.
- `module-factory/` — module lifecycle: `addLoadedModule`/`resetModuleFactory` called from loop-init.

## Autonomy mode

Session autonomy is an independent axis from per-tool risk classification. Each
session declares an `autonomyMode` at construction (`passive`, `supervised`, or
`autonomous`). The tool runner consults `resolveAutonomyGate` before the
guardrail policy:

- `passive` — denies any non-safe tool. Read-only sessions.
- `supervised` — queues any non-safe tool for operator approval, regardless of
  the guardrail policy. The approval queue is the operator's single point of
  control.
- `autonomous` — falls through to the normal guardrail policy.

Autonomy mode is required at every session boundary (CLI, channels, server,
workflow agent steps). It is not optional, and there is no silent fallback.
Workflow agent steps map their mode to the SDK's `permissionMode` and, in
passive mode, add write-capable tools (`Edit`, `Write`, `NotebookEdit`, `Bash`)
to `disallowedTools` because the subprocess SDK cannot see the KOTA tool-runner.

Mode is an operator control, orthogonal to the per-tool approval queue.
Operators change a running session's mode through the daemon control API
(PATCH /sessions/:id); the agent never sees mode-change events directly, only
the effective tool gating on the next tool call. A mid-run switch from
`autonomous` to `supervised` applies to the next tool call, not to calls
already in flight — the loop reads the session's current mode fresh each tool
batch.

The default for a fresh interactive session comes from the
`config.serve.defaultAutonomyMode` knob when clients do not request an
explicit mode. There is no compile-time default anywhere else.

## Logical clusters

- Delegate: `delegate.ts`, `delegate-agent-sdk.ts`, `delegate-config.ts`,
  `delegate-format.ts`, `delegate-turn.ts` — sub-agent spawning.
- Custom tools: `custom-tool.ts`, `custom-tool-handlers.ts`,
  `custom-tool-persistence.ts` — user-defined tool extensibility.
- Guardrails: `guardrails.ts`, `guardrails-classify.ts`, `audit-store.ts` —
  risk classification and audit trail.

