# Claude Agent Harness Module

Adapter module that registers the `claude-agent-sdk` harness with the core
agent-harness registry. The adapter is a thin wrapper around
`executeWithAgentSDK` in `src/core/agent-sdk/` — the core directory owns the
executor primitive and system-prompt builder, and this module owns the
public harness surface plus claude-SDK-specific option wiring.

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
- `settingSources` defaults to `["project"]` inside the adapter when the
  caller passes `undefined`. This preserves the prior autonomy behavior
  (loading the project's Claude Code settings) without forcing every step
  definition to restate the field; an explicit caller value still wins.
- Declared capabilities: `askOwnerToolName =
  "mcp__kota_owner_questions__ask_owner"`, `emitsAgentMessageStream = true`.
- No operational logic lives here beyond registration and the claude-SDK
  option translation — update `src/core/agent-sdk/` if you need to change
  executor behavior.
