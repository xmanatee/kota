---
id: task-add-native-gemini-cli-harness-managed-preset
title: Add native Gemini CLI harness-managed preset
status: ready
priority: p2
area: modules
summary: Add a native Gemini CLI harness and preset so KOTA can run through the installed gemini CLI with OAuth or Code Assist login, separate from the existing SDK/API-key-backed Gemini adapter.
created_at: 2026-05-14T03:24:55.009Z
updated_at: 2026-05-14T03:24:55.009Z
---

## Problem

KOTA now ships a `gemini` harness, but the local module contract shows it is
SDK/API-key backed: `src/modules/gemini-agent-harness/AGENTS.md` says it uses
`@google/genai` and reads `GEMINI_API_KEY` or `GOOGLE_API_KEY`. That is useful,
but it does not satisfy the original "run the daemon powered by gemini-cli"
operator intent in the same way the `codex` preset shells through the installed
Codex CLI and honors local login state.

The upstream Gemini CLI has become a viable native harness surface rather than
just an optional peer binary. Its current repo/docs describe Google OAuth /
Code Assist login, weekly stable/preview/nightly release channels, headless
`gemini -p ... --output-format json`, and stream-json event output for
long-running automated work. It also owns its own built-in tools, MCP
configuration, checkpointing, and sandbox/trusted-folder controls. KOTA should
not keep calling the existing SDK adapter "Gemini CLI parity" when the runtime,
auth boundary, and tool-hosting surface are different.

## Desired Outcome

KOTA has an explicit native Gemini CLI harness path, separate from the existing
SDK-backed `gemini` adapter. Operators can select a shipped preset such as
`gemini-cli` to run KOTA through the installed `gemini` binary with
harness-managed Google login / Code Assist auth, while the existing `gemini`
preset remains the API-key SDK path.

The native adapter reports its local runtime and auth boundary through the
existing preset-readiness/doctor path, parses Gemini CLI JSON or stream-json
output into `AgentHarnessResult`, and makes unsupported neutral options loud
instead of silently pretending KOTA-hosted tool control is available when the
CLI owns the tool loop.

## Constraints

- Keep this as a module-owned harness adapter, likely
  `src/modules/gemini-cli-agent-harness/`. Do not grow vendor-specific code in
  core.
- Do not replace the existing SDK-backed `gemini` preset. Add a distinct
  preset/harness id so API-key users and native-CLI-login users have explicit
  surfaces.
- Reuse the existing preset registry, harness registry, readiness probe, and
  doctor rendering. Do not add a second preset or auth registry.
- Prefer Gemini CLI's documented non-interactive structured modes:
  `gemini -p ... --output-format json` or `--output-format stream-json`.
  Avoid scraping human TTY output.
- Treat Google OAuth / Code Assist login as harness-managed auth, like Codex
  ChatGPT login. Do not require `GEMINI_API_KEY` for the native CLI preset
  unless the operator explicitly chooses the SDK-backed preset.
- If Gemini CLI cannot expose KOTA's tool registry, `canUseTool`, MCP server
  map, supervised approvals, or file checkpointing through its headless mode,
  reject those options at the adapter boundary and document the capability
  boundary locally.
- Preserve KOTA workflow rails. The adapter must still carry the no-direct-
  commit and no-daemon-control instructions, and must not claim support for
  autonomous builder flows until the guardrails path is genuinely enforced or
  a loud boundary is documented.

## Done When

- A native Gemini CLI adapter module registers a new harness id and shells
  through the installed `gemini` binary in non-interactive structured-output
  mode.
- A shipped preset selects that harness and records harness-managed auth
  readiness without requiring `GEMINI_API_KEY` / `GOOGLE_API_KEY`.
- `kota doctor --preset <native-gemini-cli-preset>` reports:
  preset id, harness id, model/tier map, `gemini --version` path/version,
  local login/auth readiness or a clear "run gemini and sign in" failure, and
  unsupported neutral options.
- The adapter parses successful CLI output, CLI errors, aborts, and empty
  output into typed `AgentHarnessResult` cases with focused tests using fake
  CLI processes or fixtures. No test needs real Google auth.
- The preset-parity preflight includes the new preset's readiness object, while
  live scenario execution may skip/fail clearly when the local Gemini CLI login
  is absent.
- Local `AGENTS.md` documents the native CLI loop shape, auth boundary, release
  channel assumption, and rejected options without repeating the SDK-backed
  Gemini module docs.

## Source / Intent

Explorer run `2026-05-14T03-21-57-081Z-explorer-kq5lfw` refreshed the
Gemini CLI watchlist entry. Current upstream docs describe Gemini CLI as an
open-source terminal agent with built-in file/shell/web tools, MCP support,
headless scripting, JSON and stream-json output, Google OAuth / Code Assist
login, API-key mode, Vertex mode, and weekly stable/preview/nightly release
channels:

- https://github.com/google-gemini/gemini-cli
- https://www.geminicli.com/docs/cli/authentication
- https://www.geminicli.com/docs/cli/configuration

Local evidence: `src/modules/gemini-agent-harness/AGENTS.md` says KOTA's
current `gemini` harness is `@google/genai`-backed and env-key-authenticated,
with the `gemini` CLI only an optional informational runtime probe. The earlier
completed `task-ship-google-gemini-agent-harness-adapter` therefore delivered
the SDK-compatible Gemini path, not true native Gemini CLI execution.

## Initiative

Harness-preset migration: make "run the daemon powered by Codex or Gemini CLI"
true at the runtime/auth boundary, not only at the model-provider boundary.

## Acceptance Evidence

- Unit tests for the native CLI adapter covering success, CLI error, abort, and
  unsupported-option rejection using deterministic fake CLI output.
- `pnpm test:preset-parity` preflight artifact showing the native Gemini CLI
  preset readiness object and a clear missing-login branch when no local login
  is present.
- A `kota doctor --preset <native-gemini-cli-preset> --skip-connectivity`
  transcript under `.kota/runs/<run-id>/` showing the installed `gemini`
  runtime path/version and auth-readiness status.
