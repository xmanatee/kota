# REPL

Harness-neutral interactive terminal REPL. `runHarnessRepl` drives any
registered `AgentHarness` adapter (claude-agent-sdk, thin, future codex /
OpenAI-compat loops) turn-by-turn. The CLI `kota run -i` path for
harness-backed providers enters here.

- `@path` user-prompt expansion runs at this boundary via
  `expandUserPromptReferences`. Adapters receive already-expanded text.
- A local transcript is kept across turns and composed into the next
  prompt so stateless adapters (thin) still see prior context without a
  protocol extension.
- Adapters that declare `supportsMultiTurn: false` are rejected loudly at
  entry rather than silently downgraded to single-turn.
- Assistant streaming output goes through the harness writer (stdout by
  default). REPL chrome (banner, status, errors) goes through a
  `ReplChrome` resolved through the rendering provider seam
  (`getRenderingProvider().createReplChrome()`); deployments without the
  rendering module must pass a chrome explicitly or the REPL refuses to
  start.
- Slash commands stay focused on the harness conversation lifecycle:
  `/help`, `/status`, `/reset` / `/clear`. Operator-facing browse-and-
  toggle of broader runtime state (sessions, modules, approvals, secrets,
  agents) is the job of the future `src/modules/cli/` runtime navigator,
  a separate surface that consumes the `KotaClient` contract rather than
  driving an `AgentHarness` directly.
