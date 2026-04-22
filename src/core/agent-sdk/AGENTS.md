# Agent SDK

This directory hosts the packaged Claude Agent SDK executor, system-prompt
builder, MCP bridge, and guard helpers. It is the internal implementation of
the `claude-agent-harness` module — nothing else in core should import
`executeWithAgentSDK` directly. New harness adapters live in their own
modules and dispatch through the `agent-harness` registry.

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
