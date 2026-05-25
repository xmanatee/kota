# Codex Agent Harness Module

Adapter module that registers the `codex` harness. The harness shells out to
the installed Codex CLI (`codex exec --json`) instead of calling
`@openai/agents` directly. This is load-bearing: Codex CLI is the surface that
honors `codex login` and ChatGPT-plan subscription access, while the OpenAI
Agents SDK requires API-key auth.

Operators select this harness via the `codex` preset,
`KotaConfig.defaultAgentHarness: "codex"`, or a per-step `harness`.

## Provider Routing

Models are passed to `codex exec --model` verbatim (for example `gpt-5.5`,
`gpt-5.4`, `gpt-5.4-mini`). The adapter also passes
`preferred_auth_method="chatgpt"` so an exported `OPENAI_API_KEY` does not
accidentally take priority over the local Codex login.

Reasoning effort maps to Codex CLI's `model_reasoning_effort` config:

- `low` -> `low`
- `medium` -> `medium`
- `high` -> `high`
- `xhigh` / `max` -> `xhigh`

## Loop Shape

The adapter runs one non-interactive CLI process per KOTA harness call:

1. Compose the KOTA system prompt, workflow rails, and task prompt into one
   stdin prompt for `codex exec -`.
2. Spawn `codex exec --json --ignore-user-config --sandbox <mode> --model <model>`.
3. Parse JSONL events from stdout. `item.completed` agent-message events are
   streamed to the optional `AgentHarnessWriter` and collected as final text.
4. Read the final `turn.completed` usage event for token counts and return the
   neutral `AgentHarnessResult`.

`autonomyMode: "passive"` maps to Codex CLI `read-only`; every other supported
mode maps to `workspace-write`. `supervised` is rejected because this
non-interactive CLI path cannot route approvals through KOTA's approval queue.

## Capability Boundary

Codex CLI owns its own tool runtime. This adapter does not expose KOTA's tool
registry, MCP servers, `allowedTools`, `disallowedTools`, or `canUseTool` to
the model. It declares `toolControl: "native"`, so workflow, repair, and
delegate callers that intentionally use the native CLI omit KOTA-only
tool-control options through `routeKotaToolControlOptions`. Direct callers
that pass those unsupported options still fail before Codex CLI starts.
`askOwnerToolName` is therefore `null`, so workflow prompts do not advertise a
fake `ask_owner` tool. Workflows that need owner escalation should use the
deterministic `askOwnerSteps` recipe outside the agent step.

The adapter still carries KOTA's workflow rails in the prompt: agents must not
run `git commit` and must not stop or control the daemon that launched them.
Post-step workflow checks remain responsible for validating repo state.
It also passes `--ignore-user-config` so operator-global Codex MCP servers,
hooks, or config profiles cannot make daemon-launched workflow steps fail
before the KOTA prompt runs; Codex auth still comes from `CODEX_HOME`.

## Rejected Options

Reject unsupported neutral options loudly:

- `mcpServers`
- `allowedTools` / `disallowedTools`
- `canUseTool`
- `autonomyMode === "supervised"`
- `persistSession`
- `harnessOverrides`
- `enableFileCheckpointing`
- `thinkingEnabled` / `thinkingBudget`
- `onMessage`
