# Agent SDK

This directory hosts the packaged Claude Agent SDK executor, system-prompt
builder, and MCP bridge. It is the internal implementation of the
`claude-agent-harness` module — nothing else in core should import
`executeWithAgentSDK` directly. Harness-neutral pieces (commit guard,
daemon-host guard, `composeCanUseTools`) live in
`src/core/agent-harness/guards.ts` so every adapter that honors `canUseTool`
can share them without importing a claude-specific module.

- Keep the executor, types, and prompt integration aligned with the actual
  Claude Agent SDK contract.
- Changes here affect every path that runs through the claude-agent-sdk
  harness (workflow agent steps, repair loops, delegate, CLI agent-sdk
  provider).
- The SDK's `PermissionResult` TS type marks `updatedInput` optional on the
  `allow` branch, but the SDK's runtime zod schema (`_OA`) rejects responses
  without it. A `canUseTool` callback that returns `{ behavior: "allow" }`
  without `updatedInput` breaks every tool call. Route all callbacks through
  `normalizePermissionResult` / `normalizeCanUseTool` (applied automatically
  by `buildQueryOptions`); do not pass a raw `canUseTool` to `sdkQuery`.
- Owner-questions wiring lives inside the claude harness adapter: when
  `AgentHarnessRunOptions.askOwner` is set, the adapter merges
  `createOwnerQuestionMcpServers(source)` into the SDK's `mcpServers`. The
  step-executor and autonomy judges never inject `mcpServers` or
  `settingSources` directly — those fields are claude-adapter options that
  other adapters reject loudly at the boundary.
