---
id: task-carve-the-mcp-sdk-in-process-server-variant-out-of
title: Carve the MCP sdk in-process server variant out of core into the claude-agent-harness module
status: done
priority: p2
area: architecture
summary: Move AgentMcpSdkServerConfig and the {type: 'sdk', instance: unknown} MCP variant out of the core AgentMcpServers union into the claude-agent-harness module where it is actually produced (createSdkMcpServer) and consumed, so core's MCP protocol surface stops carrying a claude-SDK-only in-process variant every other adapter has to reject.
created_at: 2026-04-24T03:42:08.883Z
updated_at: 2026-04-24T03:52:23.728Z
---

## Problem

`src/core/agent-harness/types.ts` defines `AgentMcpServers` as a
discriminated union over `stdio | sse | http | sdk`. The `sdk` variant —
`AgentMcpSdkServerConfig = { type: "sdk"; name: string; instance: unknown }`
— is explicitly documented as a claude-agent-sdk internal: only
`src/modules/claude-agent-harness/kota-tools-mcp.ts` constructs values via
`createSdkMcpServer`, only `src/modules/claude-agent-harness/executor.ts`
consumes them, and every non-claude adapter has to reject the shape at its
boundary. The type's `instance: unknown` escape hatch exists solely because
the real runtime type is a claude-agent-sdk `McpServer` that core refuses to
import. This is the same bleed-through pattern the recent core-shrinking
arc has been extracting (step-options carve-out, SDK query options, step
fields, executor), just one level down in the MCP contribution shape.

The three remote MCP variants (`stdio`, `sse`, `http`) describe external
transports and legitimately belong in core. The `sdk` variant is a
claude-only in-process hosting mechanism and should live with the adapter
that owns it.

## Desired Outcome

- Core's `AgentMcpServers` union covers only the transport variants every
  harness can reason about (`stdio | sse | http`). No `instance: unknown`
  escape hatch.
- The claude-agent-harness module defines its own carve-out type for the
  in-process `sdk` variant and threads it through its own adapter surface,
  not through the neutral `AgentMcpServers` shape.
- `createSdkMcpServer` construction and consumption stay co-located in the
  claude module; no other harness has to know the `sdk` variant exists.
- The AGENTS.md references to the `sdk` variant (core agent-harness and
  module-level docs) are updated or removed so the boundary is clear.

## Constraints

- Harness-neutral callers (workflow steps, session composition, CLI) must
  not have to special-case "is this the claude harness?" to pass in-process
  tools; the claude adapter should accept its carve-out via the same
  per-harness options mechanism already used for step-options.
- Do not reintroduce a second parallel config path in core that exists only
  to transport claude-specific data through neutral code.
- Preserve existing behavior for `kotaOwnerQuestions` MCP tools: the
  `ask_owner` tool must continue to be hosted under the claude harness via
  the in-process server today, and the non-claude adapters must continue
  to reject unsupported MCP shapes loudly.

## Done When

- `AgentMcpSdkServerConfig` and any `type: "sdk"` branch are gone from
  `src/core/agent-harness/types.ts` and the core `AgentMcpServers` union.
- The claude-agent-harness module owns its own in-process-server type and
  integration; `grep -r "createSdkMcpServer" src/core` returns empty.
- Non-claude harness adapters no longer need a reject-branch for the `sdk`
  variant because the type no longer exists at their boundary.
- `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass.
- Scoped AGENTS.md files (`src/core/agent-harness`, `src/modules/claude-agent-harness`)
  describe the new boundary without stale `sdk`-variant references.
