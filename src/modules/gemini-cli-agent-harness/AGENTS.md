# Gemini CLI Agent Harness Module

Adapter module that registers the `gemini-cli` harness. The harness shells out
to the installed Gemini CLI in headless structured-output mode instead of using
`@google/genai` directly. This is now the legacy Gemini CLI surface that honors
Gemini CLI's cached Google sign-in / Code Assist auth state.

Route work here with the `gemini-cli` preset, default harness config, or a
per-step `harness` value.

## Migration Posture

Google announced that on June 18, 2026, Gemini CLI and Gemini Code Assist IDE
extensions stop serving requests for Google AI Pro / Ultra and free individual
access. Operators should choose:

- `antigravity-cli` for Google's current native terminal-agent runtime and
  local Antigravity readiness checks.
- `gemini` for SDK-backed Gemini runs using `GEMINI_API_KEY` or
  `GOOGLE_API_KEY`.
- `gemini-cli` only for legacy Gemini CLI access that remains supported for
  enterprise/API-key paths or existing environments that still need the Gemini
  CLI binary.

## Provider Routing

Models are passed to `gemini --model` verbatim. The shipped `gemini-cli`
preset intentionally uses the same Gemini model tier names as the SDK-backed
`gemini` preset; the difference is the runtime and auth boundary, not a
separate model catalog.

Authentication is harness-managed. The readiness probe checks for the local
Gemini CLI executable plus cached Gemini CLI Google OAuth / Code Assist
credentials under the CLI's normal user config directory. It does not require
`GEMINI_API_KEY` or `GOOGLE_API_KEY`; those env vars belong to the SDK-backed
`gemini` preset.

## Loop Shape

The adapter runs one non-interactive CLI process per KOTA harness call:

1. Compose the KOTA system prompt, workflow rails, and task prompt into one
   `--prompt` payload.
2. Spawn `gemini --prompt <payload> --output-format stream-json --model <model>`.
3. Require Gemini CLI's native sandbox for every run and wrap the whole CLI in
   KOTA's machine-authority OS sandbox.
4. Parse newline-delimited JSON events. Assistant message chunks stream to the
   optional `AgentHarnessWriter`; the final `result` event supplies response
   text and usage stats.
5. Return the neutral `AgentHarnessResult`.

`autonomyMode: "passive"` maps to Gemini CLI plan approval mode. Other modes
use Gemini CLI's default approval behavior, which may fail loudly in headless
runs when the CLI needs an approval KOTA cannot provide.

## Capability Boundary

Gemini CLI owns its own tool runtime, MCP configuration, checkpointing, and
approval loop. This adapter does not expose KOTA's tool registry, `canUseTool`,
scope-policy evaluator, MCP servers, owner-question tool, or supervised
approvals to the CLI. It declares `toolControl: "native"`. It still injects
KOTA workflow rails into the prompt, but those rails are prompt-level
instructions rather than KOTA-enforced tool guardrails.

Do not treat this adapter as an autonomous builder-equivalent until a guarded
tool-control path exists. It is safe as a native CLI runtime boundary and for
headless tasks that the CLI can complete under its own approval policy.
The unsupported tool-control options are declared on the harness and reported
through readiness; direct callers that pass them fail before Gemini CLI starts.

## Release Channel

Assume the operator-installed `gemini` binary is from the stable Gemini CLI
channel unless the operator explicitly installs preview or nightly. Readiness
reports the exact local path and `gemini --version` output.
