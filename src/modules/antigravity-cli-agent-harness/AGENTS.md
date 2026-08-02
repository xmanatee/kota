# Antigravity CLI Agent Harness Module

Adapter module that registers the `antigravity-cli` harness. The harness is the
KOTA preset path for Google's Antigravity CLI (`agy`), the native terminal
runtime replacing consumer Gemini CLI access after June 18, 2026.

Select it with the `antigravity-cli` preset, default harness config, or a
per-step `harness` override.

## Provider Routing

Antigravity CLI owns provider routing inside its native runtime. The shipped
preset maps KOTA tiers to the current local Antigravity model family and the
adapter passes the selected id to `agy --model` for the one-shot run.

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
commands, settings, plugins, permissions, migration commands, and
`agy --print` for non-interactive text output. They do not document a stable
structured-output mode equivalent to `codex exec --json` or
`gemini --output-format stream-json`.

`run()` executes one `agy --print` subprocess and returns the final text. It
does not expose token deltas, native tool-call events, session ids, or
`KotaAgentMessage` frames. This keeps the preset useful for text-only native
AGY runs without pretending KOTA can supervise AGY's internal tool loop.
Every invocation requires AGY's native sandbox; autonomous mode changes the
approval posture, never the filesystem isolation boundary.

## Capability Boundary

Antigravity CLI owns plugins, skills, hooks, subagents, MCP configuration,
browser use, sandboxing, and approvals. This adapter does not expose KOTA's
tool registry, `canUseTool`, owner-question routing, supervised approvals, or
scope-policy evaluation or MCP server injection to AGY. It declares
`toolControl: "native"` and rejects
unsupported KOTA-only options before launching `agy`.
