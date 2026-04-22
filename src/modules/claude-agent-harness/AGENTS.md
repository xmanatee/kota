# Claude Agent Harness Module

Adapter module that registers the `claude-agent-sdk` harness with the core
agent-harness registry. The adapter is a thin wrapper around
`executeWithAgentSDK` in `src/core/agent-sdk/` — the core directory owns the
executor primitive plus guardrail helpers, and this module owns the public
harness surface.

- Registration happens as a side effect of importing this module (mirrors
  `src/modules/model-clients/`). Tests that exercise paths depending on the
  claude harness must import `#modules/claude-agent-harness/index.js` in
  their setup.
- Guardrails (commit guard, daemon control guard, tool allow/deny lists,
  MCP servers) are passed in through `AgentHarnessRunOptions` and applied by
  the underlying SDK call.
- No operational logic lives here beyond registration — update
  `src/core/agent-sdk/` if you need to change executor behavior.
