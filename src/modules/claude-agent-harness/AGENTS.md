# Claude Agent Harness Module

Adapter module that registers the `claude-agent-sdk` harness with the core
agent-harness registry. This module owns every Claude-Agent-SDK-specific piece
of runtime: the `executeWithAgentSDK` primitive (`executor.ts`), the owner-
questions MCP bridge (`kota-tools-mcp.ts`), the claude-shaped query/option
declarations (`sdk-types.ts` — `SDKQueryOptions`, `SDKSystemPrompt`,
`SDKThinkingConfig`, `SDKQueryParams`, `SDKQueryFn`, `SDKModule`), the
adapter-private permission/setting literal types
(`ClaudeAgentSdkPermissionMode`, `ClaudeAgentSdkSettingSource`,
`ClaudeAgentSdkStepOverrides` in `executor.ts`), and the adapter that
translates the KOTA-native `AgentHarnessRunOptions` (autonomy mode, tools,
prompt, owner-questions) into SDK wire shape. This module owns the
`KotaTool` ↔ claude-agent-sdk tool-definition translation at the
native-loop seam (see `src/core/agent-harness/AGENTS.md`). The harness-
neutral wire-frame declarations (`KotaAgentMessage`,
`AgentDecisionAttribution`, `AgentCanUseTool`) live in
`src/core/agent-harness/` because the workflow runtime consumes them
directly; nothing in core imports `@anthropic-ai/claude-agent-sdk`.

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
- The claude-agent-sdk in-process `sdk` MCP variant (`createSdkMcpServer`,
  `{type: "sdk", name, instance}`) is adapter-private. The neutral
  protocol covers only the transport variants (`stdio | sse | http`);
  `executor.ts` exports `ClaudeAgentMcpServers` as the adapter-internal
  extended map that combines the neutral variants with the live in-process
  entry, and the adapter is the only place the two views meet. Neutral
  callers cannot pass in-process servers directly; route any future
  claude-specific in-process tool through this adapter's owner-questions-
  style internal wiring rather than re-adding an in-process field to the
  neutral shape.
- The adapter maps KOTA's neutral `autonomyMode` to the SDK's native
  permission knob: `autonomous` → `bypassPermissions`, `passive` →
  `default`, `supervised` → throws (the SDK has no operator-approval-queue
  routing). Callers that omit `autonomyMode` get the `autonomous` default.
  Per-step overrides live on the workflow step's
  `harnessOptions["claude-agent-sdk"]` block (see
  `src/core/agent-harness/AGENTS.md`); the adapter's `validateStepOptions`
  is the only place the claude-specific permission/setting literals live.
  The validated fragment travels through `harnessOverrides` on the neutral
  run options as opaque `AgentHarnessStepOverrides`. Setting-source
  defaults to `["project"]` inside the adapter when the override is unset.
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
