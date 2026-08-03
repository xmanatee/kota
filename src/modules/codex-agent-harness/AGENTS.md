# Codex Agent Harness Module

Adapter module that registers the `codex` harness. The harness shells out to
the installed Codex CLI (`codex exec --json`) instead of calling
`@openai/agents` directly. This is load-bearing: Codex CLI is the surface that
honors `codex login` and ChatGPT-plan subscription access, while the OpenAI
Agents SDK requires API-key auth.

Use the `codex` preset, default harness config, or a per-step `harness` to
route a run through this adapter.

## Provider Routing

Models are passed to `codex exec --model` verbatim. The shipped Codex preset
maps fast, balanced, and capable work to GPT-5.6 Luna, Terra, and Sol. The
adapter removes `OPENAI_API_KEY` from the child process so an exported API key
does not take priority over the local Codex login.

KOTA supports Codex CLI `0.144.1` or newer for this GPT-5.6 integration.

Reasoning effort maps to Codex CLI's `model_reasoning_effort` config:

- `low` -> `low`
- `medium` -> `medium`
- `high` -> `high`
- `xhigh` -> `xhigh`
- `max` -> `max`

## Loop Shape

The adapter runs one non-interactive CLI process per KOTA harness call:

1. Compose the KOTA system prompt, workflow rails, and task prompt into one
   stdin prompt for `codex exec -`.
2. Spawn an ephemeral, strict-config `codex exec --json` process with user
   plugins and hooks disabled, the selected model, and Codex's internal
   sandbox bypassed. KOTA owns the one OS sandbox around the process: passive
   runs can write only to an invocation temp root; autonomous runs can also
   write to the workspace; Git metadata and machine authority stay read-only.
   Codex gets a fresh runtime home under that temp root containing only the
   host login file, so its SQLite state cannot dirty the operator's home.
3. Parse JSONL events from stdout. `item.completed` agent-message events are
   streamed to the optional `AgentHarnessWriter` and collected as final text.
4. Read the final `turn.completed` usage event for token counts and return the
   neutral `AgentHarnessResult`.

`autonomyMode: "passive"` maps to KOTA's read-only native-CLI boundary; every
other supported mode maps to workspace-write. `supervised` is rejected because this
non-interactive CLI path cannot route approvals through KOTA's approval queue.

## Capability Boundary

Codex CLI owns its own tool runtime. This adapter does not expose KOTA's tool
registry, MCP servers, `allowedTools`, `disallowedTools`, `canUseTool`, or
scope-policy evaluator to the model. It declares `toolControl: "native"` and
rejects unsupported neutral options before Codex CLI starts.
`askOwnerToolName` is therefore `null`, so workflow prompts do not advertise a
fake `ask_owner` tool. Workflows that need owner escalation should use the
deterministic `askOwnerSteps` recipe outside the agent step.

The adapter still carries KOTA's workflow rails in the prompt: agents must not
run `git commit` and must not stop or control the daemon that launched them.
Post-step workflow checks remain responsible for validating repo state.
It also passes `--ignore-user-config` and explicitly disables plugins and hooks
so operator-global extensions cannot affect daemon-launched workflow steps;
Codex auth is copied from `CODEX_HOME` into the per-invocation runtime home.
Trusted host isolation may replace `HOME`; the adapter projects only the
resolved `CODEX_HOME` locator so local login remains available without
restoring the operator home environment.
