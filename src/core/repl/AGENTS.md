# REPL

Harness-neutral interactive REPL. `runHarnessRepl` drives any registered
`AgentHarness` adapter turn-by-turn: claude-agent-sdk, thin, or a future
adapter. The CLI `run -i` path for harness-backed providers enters here.

- `@path` user-prompt expansion runs at this boundary via
  `expandUserPromptReferences`. Adapters receive already-expanded text.
- A local transcript is kept across turns and composed into the next
  prompt so stateless adapters (thin) still see prior context without a
  protocol extension.
- Adapters that declare `supportsMultiTurn: false` are rejected loudly at
  entry rather than silently downgraded to single-turn.
- Assistant streaming output goes through the harness writer (stdout by
  default). REPL chrome (banner, status, errors) goes through a separate
  `TerminalTransport` bound to stderr so scripted pipelines stay clean.
