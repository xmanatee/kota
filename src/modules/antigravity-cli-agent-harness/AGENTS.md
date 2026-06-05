# Antigravity CLI Agent Harness Module

Adapter module that registers the `antigravity-cli` harness. The harness is the
KOTA preset path for Google's Antigravity CLI (`agy`), the native terminal
runtime replacing consumer Gemini CLI access after June 18, 2026.

Operators select this harness via the `antigravity-cli` preset,
`KotaConfig.defaultAgentHarness: "antigravity-cli"`, or a per-step `harness`.

## Provider Routing

Antigravity CLI owns model choice through its native settings and `/model`
surface. The shipped preset maps KOTA tiers to the documented local
Antigravity model family so operator-facing preset output stays concrete, but
the adapter does not pass model ids to `agy` until Google documents a stable
headless command contract.

Authentication is harness-managed. The CLI authenticates through the operating
system secure keyring and falls back to browser sign-in. KOTA probes the local
`agy` executable and reports that no documented non-interactive auth-status
command is available; it must not inspect or infer secrets from the OS keyring.

## Local Paths

Antigravity-specific files stay local to this module:

- Global settings: `~/.gemini/antigravity-cli/settings.json`
- Keybindings: `~/.gemini/antigravity-cli/keybindings.json`
- Plugins: `~/.gemini/antigravity-cli/plugins/`
- MCP config: `~/.gemini/antigravity-cli/mcp_config.json`

Workspace customizations are Antigravity-owned (`.agents/skills` and
`.agents/mcp_config.json`). Do not translate them into KOTA tool settings.

## Loop Shape

Current public AGY CLI docs describe an interactive terminal UI, slash
commands, settings, plugins, permissions, and migration commands. They do not
document a stable non-interactive structured-output mode equivalent to
`codex exec --json` or `gemini --output-format stream-json`.

Until that boundary exists, `run()` returns a typed unsupported result instead
of scraping terminal UI output. This keeps the preset selectable for readiness
and migration checks without pretending KOTA can enforce tool-control rails
inside AGY.

## Capability Boundary

Antigravity CLI owns plugins, skills, hooks, subagents, MCP configuration,
browser use, sandboxing, and approvals. This adapter does not expose KOTA's
tool registry, `canUseTool`, owner-question routing, supervised approvals, or
MCP server injection to AGY. It declares `toolControl: "native"` and rejects
unsupported KOTA-only options before returning the unsupported execution
result.

## Rejected Options

Reject unsupported neutral options loudly:

- `mcpServers`
- `allowedTools` / `disallowedTools`
- `canUseTool`
- `askOwner`
- `autonomyMode === "supervised"`
- `persistSession`
- `resumeSessionId`
- `harnessOverrides`
- `enableFileCheckpointing`
- `thinkingEnabled` / `thinkingBudget`
- `onMessage`
