# Claude Agent Harness Module

Adapter module that registers the `claude-agent-sdk` harness with the core
agent-harness registry. This module owns every Claude-Agent-SDK-specific piece
of runtime: the `executeWithAgentSDK` primitive (`executor.ts`), the owner-
questions MCP bridge (`kota-tools-mcp.ts`), the claude-shaped query/option
declarations (`sdk-types.ts` — `SDKQueryOptions`, `SDKSystemPrompt`,
`SDKThinkingConfig`, `SDKQueryParams`, `SDKQueryFn`, `SDKModule`), and the
adapter that translates neutral `AgentHarnessRunOptions` into SDK wire shape.
The harness-neutral wire-frame declarations (`SDKMessage`, `SDKPermissionMode`,
`SDKSettingSource`) live in `src/core/agent-harness/sdk-types.ts` because the
workflow runtime consumes them directly; nothing else in core imports
`@anthropic-ai/claude-agent-sdk`.

- Registration happens as a side effect of importing this module (mirrors
  `src/modules/model-clients/`). Tests that exercise paths depending on the
  claude harness must import `#modules/claude-agent-harness/index.js` in
  their setup.
- Guardrails (tool allow/deny lists, MCP servers, composed `canUseTool`) are
  passed in through `AgentHarnessRunOptions` and applied by the underlying
  SDK call. The harness-neutral commit + daemon guards live in
  `src/core/agent-harness/guards.ts`; callers compose those and hand the
  result to `runAgentHarness` through the neutral `canUseTool` field.
- Owner-questions surface is adapter-owned: when `askOwner` is present, the
  adapter merges `createOwnerQuestionMcpServers(source)` into the SDK's
  `mcpServers` map. Callers never inject that MCP server themselves.
- `settingSources` defaults to `["project"]` and `permissionMode` defaults to
  `"bypassPermissions"` inside the adapter when the caller passes
  `undefined`. Autonomy workflow steps rely on these defaults by omitting
  the `harnessOptions` carve-out entirely. An explicit value on the neutral
  `AgentHarnessRunOptions` (including `"default"` forced by passive autonomy
  mode) still wins. Per-step overrides live on the workflow step's
  `harnessOptions["claude-agent-sdk"]` block (see
  `src/core/agent-harness/AGENTS.md`); the adapter's `validateStepOptions`
  is the only place the claude-specific enum literals live.
- Declared capabilities: `askOwnerToolName =
  "mcp__kota_owner_questions__ask_owner"`, `emitsAgentMessageStream = true`.
- The claude-SDK `PermissionResult` TS type marks `updatedInput` optional on
  the `allow` branch, but the SDK's runtime zod schema rejects responses
  without it. All permission callbacks route through
  `normalizePermissionResult` / `normalizeCanUseTool` (applied automatically
  by `buildQueryOptions`); do not pass a raw `canUseTool` to `sdkQuery`.
- Tests that need to mock `executeWithAgentSDK` mock
  `#modules/claude-agent-harness/executor.js` directly — the harness-neutral
  seam (`#core/agent-harness/runner.js`) stays visible in test code, so
  non-claude adapters are not silently routed through a claude-shaped mock.
