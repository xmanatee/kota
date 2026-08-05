# Gemini CLI Agent Harness Module

Adapter module that registers the `gemini-cli` harness. The harness shells out
to the installed Gemini CLI in headless structured-output mode instead of using
`@google/genai` directly and honors Gemini CLI's cached Google sign-in / Code
Assist auth state.

Route work here with the `gemini-cli` preset, default harness config, or a
per-step `harness` value.

Gemini CLI remains the Google enterprise and API-key native CLI path. Google
individual-account OAuth is not served by Gemini CLI; use the existing
`antigravity-cli` preset for that account type.

## Provider Routing

Models are passed to `gemini --model` verbatim. The shipped `gemini-cli`
preset intentionally uses the same Gemini model tier names as the SDK-backed
`gemini` preset; the difference is the runtime and auth boundary, not a
separate model catalog.

Authentication is harness-managed. The readiness probe checks for the local
Gemini CLI executable plus cached Gemini CLI Google OAuth / Code Assist
credentials under the CLI's normal user config directory. Each run copies only
those credentials and the selected auth mode into its isolated home. The
session-only `--skip-trust` flag satisfies Gemini CLI's headless bootstrap;
KOTA's OS sandbox remains the single filesystem and network authority. A
symlinked project settings file is readable only as the configuration input
Gemini requires before applying that session flag.
Gemini-specific API keys remain supported when explicitly configured, while
unrelated daemon credentials and global tools, MCP, prompt, and `.env` files
are not projected.

## Loop Shape

The adapter runs one non-interactive CLI process per KOTA harness call:

1. Compose the KOTA system prompt, workflow rails, and task prompt into one
   `--prompt` payload.
2. Spawn `gemini --skip-trust --prompt <payload> --output-format stream-json
   --model <model>`.
3. Run the CLI inside KOTA's single native-CLI OS sandbox. Plan mode can write
   only to an invocation temp root; default mode can also write to the
   workspace. Reads stay within system/tool runtime, workspace dependencies,
   workspace, and invocation roots; Git metadata and machine authority stay
   read-only. Network access is restricted to declared Google model and
   authentication endpoints through KOTA's host-owned proxy.
4. Parse newline-delimited JSON events. Assistant message chunks stream to the
   optional `AgentHarnessWriter`; the final `result` event supplies response
   text and usage stats.
5. Return the neutral `AgentHarnessResult`.

Cancellation terminates the CLI process group so spawned tools cannot outlive
the CLI, and the run-local quarantine barrier stays pending until the group
leader has closed.

`autonomyMode: "passive"` maps to Gemini CLI plan approval mode. Other modes
use Gemini CLI's default approval behavior, which may fail loudly in headless
runs when the CLI needs an approval KOTA cannot provide.

## Capability Boundary

Gemini CLI owns its own tool runtime, MCP configuration, checkpointing, and
approval loop. KOTA owns filesystem isolation so there is no nested sandbox.
This adapter does not expose KOTA's tool registry, `canUseTool`,
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
