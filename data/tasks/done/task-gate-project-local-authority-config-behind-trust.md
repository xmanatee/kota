---
id: task-gate-project-local-authority-config-behind-trust
title: Gate project-local authority config behind trust
status: done
priority: p2
area: architecture
summary: Add a trust boundary for project-local .kota/config.json so external projects cannot weaken guardrails, redirect providers, switch harnesses, or launch foreign modules unless the operator has explicitly trusted that project.
created_at: 2026-05-25T04:57:31.465Z
updated_at: 2026-05-25T05:20:32.921Z
completed_at: 2026-05-25T05:20:32.921Z
completed_by: builder (run 2026-05-25T05-00-01-234Z-builder-q0dv99)
---

## Problem

KOTA can now operate against external project directories, but config loading
still treats every target project's `.kota/config.json` as an equally trusted
override layer. `loadConfig()` merges global config, then project config, then
CLI/programmatic overrides, so an external repo can ship project-local config
that changes authority before any workflow or session starts.

That project-local layer can currently set or influence sensitive runtime
posture, including `guardrails.toolOverrides`, `skipConfirmations`,
`defaultAgentHarness`, `defaultPreset`, `model` / `modelTiers`,
`agentModels`, `providers`, `foreignModules`, module config under `modules`,
and `serve.noAuth`. Some of those values are legitimate in a trusted KOTA
project; in an untrusted external project they can weaken approvals, redirect
model/provider traffic, select a different harness, or start foreign module
processes from repo-controlled config.

The existing external-project tests prove file activity stays inside the
fixture project. They do not prove the operator's machine-local authority
configuration stays outside the fixture project's control.

## Desired Outcome

Project-local config has an explicit trust boundary. KOTA distinguishes
machine-local/operator-owned config from repo-owned project config before
applying authority-changing fields. Running KOTA against an external project
that has not been explicitly trusted must either ignore the project-local
config layer entirely or apply only a narrow, documented-safe subset that
cannot weaken guardrails, redirect credentials/providers, select harnesses, or
start foreign modules.

Operators get one discoverable path to trust a project, stored outside the
project tree so the project cannot mark itself trusted. Once trusted, the
project-local config behavior is explicit and auditable; when untrusted config
is ignored, KOTA warns with the path and the rejected key classes.

## Constraints

- Do not add a project-local "trust me" marker. Trust state must live in an
  operator-owned surface such as global config, daemon registry state, or
  another machine-local store.
- Preserve KOTA's own repo-local config flow for trusted/self development; do
  not break normal `.kota/config.json` use in the KOTA project.
- Keep the sensitive-key catalog in code and tests, not in durable prose docs.
  This task can name examples, but the implementation should expose one typed
  source of truth.
- Module-owned config slices need an explicit default: either declare that
  project-local values are safe, or be treated as authority-changing until the
  owning module narrows them.
- Do not silently downgrade an unsafe project override into a default when the
  operator needs to know it was ignored. Emit an actionable warning or
  validation result.
- CLI or environment overrides remain operator authority and can still opt into
  risky behavior deliberately; the block is specifically repo-controlled
  project config.

## Done When

- A project trust model exists and is consulted before applying
  `.kota/config.json` from the target project directory.
- Untrusted project config cannot set or weaken guardrail policy/tool
  overrides, `skipConfirmations`, harness/preset/model/provider routing,
  foreign modules, local server auth posture, or module config slices that have
  not explicitly opted into project-local safety.
- Trusted project config still applies through the existing `loadConfig()` path
  or a clearly named successor; trusted and untrusted behavior are both covered
  by tests.
- Daemon startup, `kota serve`, and config CLI validation surface ignored
  project-local authority keys with an actionable message.
- External-project autonomy tests include a malicious fixture config that tries
  to weaken guardrails and redirect runtime authority, and the test proves the
  machine-local/operator config wins until the fixture is trusted.
- No compatibility shim treats every external project as trusted by default.

## Source / Intent

Explorer run `2026-05-25T04-54-30-308Z-explorer-qpu2ob` reviewed a thin queue
with zero actionable ready/doing tasks. The strategic blocked alternatives were
all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External signal checked:

- `https://github.com/openai/codex/releases` now shows Codex `0.134.0-alpha.*`
  pre-releases after the stored watchlist snapshot, while `0.133.0` remains the
  latest stable release.
- `https://developers.openai.com/codex/config-reference` states that Codex
  loads project-scoped config only for trusted projects, prevents project
  config from overriding machine-local provider/auth/notification/profile/
  telemetry routing keys, and lets untrusted projects skip project-local
  config, hooks, and rules.

KOTA should not copy Codex's exact config file or permission-profile model, but
the failure shape maps directly to KOTA's external-project boundary:
repo-controlled config must not override machine-local authority.

Local evidence:

- `src/core/config/config.ts` loads global config first and project
  `.kota/config.json` second, with no trust check before merging.
- `src/core/config/config-sanitize.ts` accepts authority-changing fields from
  any raw config layer, including guardrails, provider routing, harness/preset
  selection, foreign modules, modules, and `serve.noAuth`.
- `src/core/tools/guardrails.ts` lets `toolOverrides` bypass risk-derived
  policy resolution, and `nonInteractiveConfig()` carries those overrides into
  autonomous contexts.
- `src/core/daemon/daemon-external-project.test.ts` and
  `src/modules/autonomy/autonomous-loop.integration.test.ts` prove external
  project file isolation, but do not cover untrusted project-local config.

## Initiative

External-project safety: KOTA should be usable on arbitrary target repos
without giving the repo's own config authority over the operator's credentials,
approval posture, model routing, or local process launch surface.

## Acceptance Evidence

- Focused config tests prove untrusted project config cannot override the
  sensitive fields above, while trusted project config can.
- An external-project autonomy fixture includes a malicious `.kota/config.json`
  and proves guardrails, provider/harness routing, and foreign-module loading
  still come from operator-owned config unless the project is trusted.
- A config/daemon validation transcript or snapshot shows ignored untrusted
  project config keys are reported with actionable wording.
- Existing config, daemon external-project, and autonomy external-project
  tests remain green.
