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

- `tool-groups`, `tool-middleware`, `tool-runner`, `tool-telemetry`, `tool-result`, `tool-adapters` — tool execution pipeline.
- `guardrails`, `guardrails-classify`, `audit-store` — risk assessment and audit storage.
- `repl-session` — shared REPL sessions used by custom-tool handlers and the execution module.

