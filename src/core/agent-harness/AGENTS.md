# Agent Harness Protocol

This directory hosts the harness-neutral boundary the session/step/delegate
layer calls instead of invoking a specific agent runtime (Claude Agent SDK,
OpenAI codex, thin ModelClient loop, etc.). Adapters that implement this
protocol live in modules — the core only owns the interface and the registry.

## Protocol

- `AgentHarness.run(options, writer?)` takes a prompt plus neutral options and
  returns a typed result (text, tokens, turns, subtype, isError, sessionId).
- A harness must not silently coerce unsupported options. If an adapter cannot
  honor a requested option (for example a tools list against a text-only
  harness), it should fail loudly at the boundary.
- Streaming text goes through the optional `writer` so operators see live
  output regardless of which harness runs.
- Tool risk gating, commit guards, daemon control guards, and injection-defense
  middleware are passed into the harness through standard fields
  (`canUseTool`, `mcpServers`, tool allow/deny lists). Every adapter must
  apply them; callers should not assume an adapter can skip them.
- `AgentHarness.supportsMultiTurn: boolean` declares whether the adapter can
  host an interactive conversation. The REPL entry point composes a local
  transcript and delivers it through `run()`, so any adapter that honors a
  prompt plus prior-turn context sets this to `true`. Adapters that are
  fundamentally single-shot (fire-and-forget runners, webhook returns) set
  `false` — the REPL refuses to launch them rather than silently downgrading.

## Registry and selection

- `registerAgentHarness(harness)` registers an adapter under its declared
  `name`. Modules register during load. The core never registers adapters.
- `resolveAgentHarness(name)` returns the adapter or throws with the list of
  currently registered names. There is no implicit default — failing to select
  a harness is a loud error, never a silent fallback to claude-agent-sdk.
- Call sites resolve a harness per run: workflow steps declare
  `harness`, or inherit from `KotaConfig.defaultAgentHarness` at the top level.
  The operator picks which adapter is the default for their environment.

## Relation to `src/core/agent-sdk/`

`src/core/agent-sdk/` still hosts guardrail utilities, the Claude Agent SDK
executor primitive, system-prompt builder, and MCP bridge. It is the internal
implementation of the Claude harness module; other adapters do not depend on
it.
