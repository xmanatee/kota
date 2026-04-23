---
id: task-move-claude-sdk-only-sdkqueryoptions-out-of-coreag
title: Move claude-SDK-only SDKQueryOptions out of core/agent-harness into the claude-agent-harness module
status: ready
priority: p2
area: architecture
summary: SDKQueryOptions (and its imports Options/McpServerConfig/SpawnedProcess/SpawnOptions from @anthropic-ai/claude-agent-sdk) live in src/core/agent-harness/sdk-types.ts only to derive AgentMcpServers and AgentEffort in core/types.ts. Its sole non-test consumer is the claude adapter. Move the claude-SDK-shaped options to the claude-agent-harness module; keep only harness-neutral wire types (SDKMessage, SDKPermissionMode, SDKSettingSource) in core.
created_at: 2026-04-23T22:47:06.648Z
updated_at: 2026-04-23T22:47:06.648Z
---

## Problem

Core-shrinking has removed two claude-SDK-only surfaces from `src/core/` so
far: the SDK executor plus owner-questions MCP bridge (commit f3a1b444) and
claude-SDK-shaped per-step fields like `permissionMode`/`settingSources`
(commit 000a556a). The visible claude-SDK-specific residue remaining in core
lives in `src/core/agent-harness/sdk-types.ts`:

- `SDKQueryOptions` is a verbatim restatement of the claude-agent-sdk query
  wire shape (27 fields including `pathToClaudeCodeExecutable`,
  `allowDangerouslySkipPermissions`, `spawnClaudeCodeProcess`,
  `enableFileCheckpointing`, etc.). Its sole non-test consumer is
  `src/modules/claude-agent-harness/executor.ts:buildQueryOptions`; no core
  workflow file references it directly.
- `SDKSystemPrompt`, `SDKThinkingConfig`, `SDKQueryParams`, `SDKQueryFn`, and
  `SDKModule` sit next to `SDKQueryOptions` and are equally claude-only.
- The imports that make these types compile — `Options as
  ClaudeAgentSdkOptions`, `McpServerConfig`, `SpawnedProcess`, `SpawnOptions`
  from `@anthropic-ai/claude-agent-sdk` — are the only core-side imports of
  that package today.
- Core `agent-harness/types.ts` derives the harness-neutral `AgentMcpServers =
  SDKQueryOptions["mcpServers"]` and `AgentEffort = NonNullable<SDKQueryOptions["effort"]>`
  through these claude-shaped options, which is why the claude-SDK types
  still have to exist in core at all. The effort literals (`"low" | "medium"
  | "high" | "xhigh" | "max"`) are already a KOTA concept — `AgentEffort` is
  re-exported from `#core/model/model-client.js` and used by
  `src/modules/model-clients/reasoning.ts`, `harness-parity/runner.ts`, and
  the openai-tools adapter — but its declaration path still threads through
  claude-agent-sdk.
- `src/core/AGENTS.md` is explicit: "Browser use, shell/process access,
  filesystem actions, HTTP/web access, memory backends, MCP integration, and
  operator surfaces should prefer module-owned capability packs unless a
  shared runtime primitive truly has to stay in core." `SDKQueryOptions`
  describes one specific agent runtime's query shape, not a shared runtime
  primitive.

## Desired Outcome

- `src/core/agent-harness/sdk-types.ts` no longer imports from
  `@anthropic-ai/claude-agent-sdk`. The file keeps only wire types that every
  harness adapter normalizes into: `SDKMessage` and its constituent variants
  (`SDKAssistantMessage`, `SDKResultMessage`, `SDKStatusMessage`,
  `SDKMessageWithSession`, `SDKContentBlock`), `SDKPermissionMode`, and
  `SDKSettingSource`. Consider renaming the file to drop the `SDK` prefix if
  the remaining shapes read naturally as neutral (e.g. `AgentWireMessage`);
  pick one direction and record it in the run directory.
- `SDKQueryOptions`, `SDKSystemPrompt`, `SDKThinkingConfig`, `SDKQueryParams`,
  `SDKQueryFn`, and `SDKModule` live inside `src/modules/claude-agent-harness/`
  as module-local types imported only by `adapter.ts`, `executor.ts`, and
  their tests.
- `AgentEffort` is declared in core as a plain string-literal union
  (`"low" | "medium" | "high" | "xhigh" | "max"`) with no claude-agent-sdk
  dependency. `AgentMcpServers` either becomes a core-declared neutral shape
  (a `Record<string, McpServerSpec>` where `McpServerSpec` is a KOTA-owned
  union covering the configurations the claude adapter actually consumes) or
  moves entirely into the claude adapter's surface and the neutral
  `AgentHarnessRunOptions.mcpServers` is retyped against the new declaration.
  Pick whichever reads simpler; there must not be two parallel MCP-server
  shapes.
- Core `AgentHarnessRunOptions` still carries `mcpServers`, `effort`, and
  related fields, but their types resolve without importing anything from
  `@anthropic-ai/claude-agent-sdk`.
- `src/core/agent-harness/AGENTS.md` and
  `src/modules/claude-agent-harness/AGENTS.md` describe the new split: core
  owns the neutral wire-message and permission types; the claude module owns
  its own query-options shape. No doc still tells readers that
  `SDKQueryOptions` lives in core.

## Constraints

- Do not keep a re-export bridge at the old `#core/agent-harness/sdk-types.js`
  path for the moved types. Every import updates in the same change;
  compatibility shims are forbidden by repo policy.
- Do not alter the `SDKMessage` shape or its core import path beyond the
  optional rename to a neutral name. Core workflow files
  (`step-executor.ts`, `step-executor-agent.ts`, `step-executor-parallel.ts`,
  `step-executor-foreach.ts`, `repair-loop.ts`, `active-run-handle.ts`) and
  `src/modules/workflow-ops/runs/workflow-logs.ts` must continue to consume
  the neutral wire-message type at one canonical path — pick that path once
  and update all references in the same pass.
- The claude adapter remains the only place that builds claude-SDK-shaped
  query options. Other adapters must not pick up a new
  `@anthropic-ai/claude-agent-sdk` import during this move.
- `AgentEffort` declared in core must stay value-compatible with the
  current derivation (same five literals, same default rules) so
  `model-clients/reasoning.ts`, `harness-parity/runner.ts`, the openai-tools
  adapter, and every caller of `effortToThinkingConfig` keep behaving
  identically.
- If `AgentMcpServers` becomes a core-declared neutral shape, it must cover
  the stdio/http/sse/ws variants the claude adapter actually merges today.
  Do not narrow the type to a subset that breaks existing
  `mcpServers` consumers.
- This is a refactor: the CLI, daemon, workflow runs, and harness-parity
  integration tests must not change external behavior. `pnpm typecheck` and
  the full vitest suite must stay green.

## Done When

- `grep -R "@anthropic-ai/claude-agent-sdk" src/core/` returns zero matches.
- `SDKQueryOptions`, `SDKSystemPrompt`, `SDKThinkingConfig`, `SDKQueryParams`,
  `SDKQueryFn`, and `SDKModule` are declared inside
  `src/modules/claude-agent-harness/` and imported only from there.
- `AgentEffort` resolves to a plain string-literal union declared in core,
  not derived from `SDKQueryOptions["effort"]`. Every existing consumer
  (`#core/model/model-client.js`, `model-clients/reasoning.ts`,
  `harness-parity/runner.ts`, the openai-tools and claude adapters) compiles
  without change.
- `AgentMcpServers` resolves without reaching into a claude-agent-sdk
  option-bag shape. Its concrete representation is a single canonical
  declaration — not a core alias over a module-owned type and a module alias
  over a core-owned type in parallel.
- `src/core/agent-harness/AGENTS.md` and
  `src/modules/claude-agent-harness/AGENTS.md` describe the new split
  accurately; the old sentence naming `SDKQueryOptions` as a core resident
  is updated.
- `pnpm typecheck` and the full vitest suite pass on `main` after the
  change.
