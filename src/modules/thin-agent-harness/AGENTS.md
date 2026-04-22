# Thin Agent Harness Module

Adapter module that registers the `thin` harness — a single-turn text
completion loop that uses the core ModelClient registry.

- The harness is deliberately minimal: one request, no tool loop, no MCP.
  Operators can select it when they want a claude-agent-sdk-free path against
  any provider the model-clients module ships (Anthropic, OpenAI, Ollama,
  Groq, Together, LM Studio, etc.).
- Guardrail options (canUseTool, mcpServers, allowedTools, disallowedTools)
  are rejected at the boundary. The harness has no tool surface to guard, so
  silently ignoring them would violate the guardrails-always-apply contract.
- Requires the `model-clients` module for `createModelClient` to resolve.
- System prompt must be a plain string. The Claude Agent SDK preset form is
  not portable.
