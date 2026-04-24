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
Workflow agent steps map their mode through the neutral harness-run options
(`AgentHarnessRunOptions.permissionMode`, `allowedTools`, `disallowedTools`).
Passive mode forces `permissionMode: "default"` and restricts tools to a
read-only list because the subprocess SDK cannot see the KOTA tool-runner.
Autonomous mode leaves `permissionMode` undefined on the neutral boundary and
the claude-agent-sdk adapter applies its default (`"bypassPermissions"`); a
step may override that default per-harness through its `harnessOptions`
carve-out (see `src/core/agent-harness/AGENTS.md`).

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

### Chain of command at the session boundary

Autonomy mode sits inside a four-tier instruction hierarchy at the session
boundary:

- Anthropic SDK system prompt + KOTA core safety rails ≈ Root / System.
- operator-set autonomy mode + module-contributed prompt state ≈ Developer.
- channel / session user message ≈ User.
- tool / web outputs ≈ untrusted content with no authority by default
  (enforced by the `injection-defense` module).

A user message or tool output is never a legitimate source of autonomy-mode
escalation: a lower tier cannot promote the session's mode above what the
operator set, and `injection-defense` already strips authority claims out of
ingested payloads. Mode changes flow only through the operator control path
(daemon control API). See the OpenAI Research Distillation entry in
`src/modules/autonomy/AGENTS.md` for the evidence anchor.

## Logical clusters

- Delegate: `delegate.ts`, `delegate-harness.ts`, `delegate-config.ts`,
  `delegate-format.ts`, `delegate-turn.ts` — sub-agent spawning.
- Custom tools: `custom-tool.ts`, `custom-tool-handlers.ts`,
  `custom-tool-persistence.ts` — user-defined tool extensibility.
- Guardrails: `guardrails.ts`, `guardrails-classify.ts`, `audit-store.ts` —
  risk classification and audit trail.

## Code-runner protocol

Custom tools and manifest-defined tools execute agent-authored Python or
Node.js code. Core owns the declarative surface (schema, validation,
persistence, manifest → `KotaModule` conversion) but does not depend on any
executor module. `code-runner.ts` defines the neutral `CodeRunner` protocol;
executor modules (today: `execution`) register runners at load via
`registerCodeRunner` and deregister on unload. Core callers invoke
`runCode(language, code, params, timeoutMs?)` — parameter wrapping, default
timeout, and output truncation are the runner's responsibility.

Zero registered runners is a tolerated state: `runCode` returns a loud error
result at invocation time (`No code runner registered for language "<lang>".
…`). Custom tool creation and manifest module loading remain no-ops with
respect to execution.

No file under `src/core/` may import from `#modules/execution/...` — not
production code, not tests. The repo-wide guard in
`src/core/agent-harness/no-module-imports-in-core.test.ts` rejects every
`#modules/*` subpath under `src/core/` at every commit.

