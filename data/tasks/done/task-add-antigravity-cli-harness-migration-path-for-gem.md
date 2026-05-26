---
id: task-add-antigravity-cli-harness-migration-path-for-gem
title: Add Antigravity CLI harness migration path for Gemini CLI users
status: done
priority: p2
area: modules
summary: Add an Antigravity CLI native harness and preset, then mark the existing gemini-cli preset as a legacy Gemini CLI path with readiness guidance for the June 18, 2026 consumer transition.
created_at: 2026-05-26T07:27:33.233Z
updated_at: 2026-05-26T10:51:07.000Z
---

## Problem

KOTA now ships a native `gemini-cli` harness and preset that shell out to the
installed `gemini` binary and treat cached Gemini CLI / Code Assist login as
harness-managed auth. That was the right split when Gemini CLI was the primary
Google terminal-agent runtime, but Google announced on May 19, 2026 that
consumer Gemini CLI and Gemini Code Assist IDE requests for Google AI Pro /
Ultra and free individual access stop serving on June 18, 2026. Google is
moving those users to Antigravity CLI, which has a different binary, config
surface, auth flow, plugin/skills layout, and shared Antigravity agent harness.

If KOTA keeps presenting `gemini-cli` as the Google native-CLI path without an
Antigravity alternative, operators will hit a decaying runtime while the
readiness and doctor output still say the preset is healthy as long as
`gemini --version` and old cached `~/.gemini` credentials are present.

## Desired Outcome

KOTA has an explicit Antigravity CLI harness/preset path for operators who want
Google's current native terminal-agent runtime, while the existing
`gemini-cli` preset remains a legacy Gemini CLI surface with clear readiness
guidance.

Operators can select an `antigravity-cli` preset that shells through the
installed Antigravity CLI in its documented non-interactive or scriptable
structured-output mode, reports the local binary/version and auth readiness
through `kota doctor`, and rejects unsupported KOTA tool-control options just
as loudly as the existing native CLI harnesses.

## Constraints

- Keep this as a module-owned harness adapter under `src/modules/`; do not put
  Google-specific CLI logic in core.
- Do not remove the SDK-backed `gemini` preset. It remains the API-key Gemini
  path.
- Do not silently retarget the existing `gemini-cli` preset to Antigravity. Add
  an explicit new preset/harness id, and mark Gemini CLI as legacy /
  enterprise/API-key-only where readiness text can explain the June 18, 2026
  consumer transition.
- Reuse the existing `AgentHarness`, preset registry, readiness probe, doctor,
  and preset-parity preflight surfaces. Do not add a second harness registry or
  vendor-specific preset mechanism.
- Prefer Antigravity CLI's documented structured / non-interactive interface.
  If the current CLI is TUI-only or lacks a stable headless output contract,
  implement the readiness/deprecation half and leave execution unsupported with
  a precise adapter error instead of scraping terminal UI output.
- Treat Antigravity plugins, skills, hooks, subagents, browser use, and MCP
  configuration as native-runtime owned unless the CLI exposes a reviewed
  boundary KOTA can enforce. Do not claim KOTA `canUseTool`, owner-question
  routing, supervised approvals, or MCP server injection work through this
  harness until the adapter can prove it.
- Keep the existing workflow rails in prompts, but document where Antigravity
  owns enforcement rather than KOTA.

## Done When

- A module-owned `antigravity-cli` harness registers through the existing
  harness registry and has a shipped `antigravity-cli` preset.
- `kota doctor --preset antigravity-cli --skip-connectivity` reports the
  Antigravity CLI binary/version, auth readiness, model/tier map, and rejected
  KOTA-only tool-control options.
- The existing `gemini-cli` readiness or local `AGENTS.md` text clearly names
  the June 18, 2026 consumer transition and tells operators when to choose
  `antigravity-cli`, `gemini`, or legacy `gemini-cli`.
- Adapter tests cover success, CLI error, abort, empty/malformed output, and
  unsupported-option rejection using deterministic fake CLI output or a
  deliberate "no stable headless mode" unsupported result.
- Preset tests and preset-parity preflight include the new preset without
  making live Antigravity credentials mandatory for ordinary test runs.
- Any Antigravity-specific config paths or auth-cache probes are local to the
  harness module and documented in its `AGENTS.md`.

## Source / Intent

Explorer run `2026-05-26T07-24-18-113Z-explorer-mbeone` reviewed an empty
actionable queue. The strategic blocked alternatives are all real
operator-capture waits and not movable, so opening a focused Google native CLI
migration slice is preferable to promoting blocked evidence work or creating
client fan-out.

External sources checked:

- `https://developers.googleblog.com/en/an-important-update-transitioning-gemini-cli-to-antigravity-cli/`
  says Antigravity CLI is available now, that Gemini CLI and Gemini Code Assist
  IDE extensions stop serving Google AI Pro / Ultra and free individual
  requests on June 18, 2026, and that enterprise/API-key paths retain Gemini
  CLI access.
- `https://blog.google/innovation-and-ai/technology/developers-tools/google-io-2026-developer-highlights/`
  describes Antigravity 2.0, Antigravity CLI, and the Antigravity SDK as the
  shared Google agent-first development platform.
- `https://antigravity.google/docs/cli-overview` documents Antigravity CLI as
  the terminal surface sharing the Antigravity agent harness, settings, and
  permissions with Antigravity 2.0.

Local evidence:

- `src/modules/gemini-cli-agent-harness/AGENTS.md` still assumes the operator
  has a stable `gemini` binary and cached Gemini CLI auth under the CLI's
  normal user config directory.
- `src/modules/gemini-cli-agent-harness/adapter.ts` spawns `gemini --prompt ...
  --output-format stream-json --model ...`.
- `src/core/model/preset.ts` ships `gemini-cli` as the only Google native-CLI
  preset, separate from SDK-backed `gemini`.
- No open task mentions Antigravity, and repo search only records the older
  Managed Agents decision.

## Initiative

Harness-preset migration: KOTA should keep provider-native CLI runtime choices
explicit and current without weakening the neutral `AgentHarness` boundary.

## Acceptance Evidence

- Focused tests for the new harness module and preset registry, for example
  `pnpm test src/modules/antigravity-cli-agent-harness src/core/model/preset.test.ts`.
- `kota doctor --preset antigravity-cli --skip-connectivity` transcript under
  `.kota/runs/<run-id>/` showing the binary/auth readiness branches without
  requiring live Google credentials.
- Preset-parity preflight output or test fixture showing the
  `antigravity-cli` preset is discoverable and produces a clear missing-runtime
  or missing-auth result when Antigravity CLI is absent.
