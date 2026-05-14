---
id: task-add-preset-harness-readiness-reporting
title: Add preset harness readiness reporting
status: ready
priority: p2
area: architecture
summary: Report adapter kind, local binary or package version, auth mode, and unsupported-option boundaries for each shipped preset so parity failures distinguish missing auth, missing local runtime, and adapter drift.
created_at: 2026-05-14T02:43:08Z
updated_at: 2026-05-14T02:43:08Z
---

## Problem

KOTA now has shipped presets for Claude, Codex, and Gemini, but the operator-facing
preflight only reports the preset auth contract. That is not enough for
harness-migration work: a failing Codex run may mean the `codex` binary is
missing, the installed CLI is stale, local ChatGPT login is absent, or KOTA sent
an unsupported neutral option to an adapter that cannot honor it. Gemini has the
opposite ambiguity: KOTA's shipped `gemini` harness is SDK-backed, while the peer
Gemini CLI is moving quickly with stable, preview, and nightly channels. The
preflight should make the active local runtime explicit instead of leaving the
operator to infer it from a later agent failure.

## Desired Outcome

KOTA exposes one preset-harness readiness report that is consumed by `kota doctor
--preset`, preset-parity preflight artifacts, and any future operator-facing
harness migration report. For every shipped preset, the report names:

- preset id, harness id, default model, and resolved tier map;
- adapter kind (`agent-sdk`, `native-cli`, `provider-sdk`, or another closed
  typed value if a future adapter needs it);
- local runtime probe result, such as `codex --version` plus executable path for
  Codex, SDK package/version for Claude and Gemini, and a clear missing-runtime
  failure where applicable;
- auth mode and current auth readiness (`authEnv` alternatives present/missing,
  or harness-managed login with a non-network local probe when available);
- unsupported neutral options that this adapter rejects loudly, so a parity
  failure can be read as an adapter boundary rather than a generic provider
  failure.

The report is structured data first and rendered text second. The structured
shape is stable enough for tests and run artifacts; the rendered output remains
concise and readable.

## Constraints

- Do not add a second preset registry. Derive preset identity and model tiers
  from `src/core/model/preset.ts`.
- Keep adapter-specific probes owned by the adapter modules where possible.
  Core may own only the small shared readiness result type if the doctor and
  preset-parity gate both consume it.
- Do not make network calls in readiness checks. Provider connectivity remains
  the existing doctor connectivity concern; this task is about local runtime,
  auth contract, and adapter capability shape.
- Missing optional peer CLIs must not fail SDK-backed presets. For example,
  absence of `gemini` CLI is informational if KOTA is using the Google Gen AI
  SDK harness.
- Do not silently coerce unsupported adapter options into noops. The report
  should reflect the same boundaries the adapters enforce at runtime.

## Done When

- A typed readiness result exists for preset-backed harnesses and includes
  adapter kind, local runtime probe, auth readiness, and unsupported-option
  boundaries.
- `kota doctor --preset <id>` renders the readiness result for at least
  `claude`, `codex`, and `gemini`.
- `pnpm test:preset-parity` preflight artifacts include the same structured
  readiness object for each preset, even when the scenario itself is skipped
  because live auth is unavailable.
- Codex missing-binary, Codex version-success, Gemini SDK-backed/no-Gemini-CLI,
  and missing env-auth cases are covered by tests without real provider calls.
- The implementation leaves the existing cross-preset runtime parity gate
  blocked on its live operator captures; this task improves diagnosis and
  preflight evidence, not the live capture requirement itself.

## Source / Intent

Explorer refresh on 2026-05-14 found the shipped peer harnesses continuing to
move quickly:

- `https://github.com/openai/codex` presents Codex as a local CLI and advertises
  a latest release of `0.130.0` on 2026-05-08.
- `https://github.com/google-gemini/gemini-cli` documents stable, preview, and
  nightly release channels plus multiple auth modes; the repo page shows latest
  release `v0.42.0` on 2026-05-12.
- `https://github.com/anthropics/claude-code` says npm installation is
  deprecated and points operators at native installer paths.

Existing blocked tasks already require live operator captures for parity. This
task is the autonomous preflight slice those blocked tasks do not cover:
before asking an operator to capture another expensive live run, KOTA should
say exactly which local harness runtime and auth boundary it is about to use.

## Initiative

Harness-preset migration: make preset selection and adapter readiness observable
before live provider calls so Codex/Gemini/Claude parity failures have actionable
local causes.

## Acceptance Evidence

- Unit tests for the pure readiness gatherer using fake binary/package probes.
- A `pnpm test:preset-parity` fixture or transcript showing preflight JSON with
  per-preset readiness objects while provider auth is absent.
- A `kota doctor --preset codex` transcript under `.kota/runs/<run-id>/` showing
  the missing-binary or version-present branch with actionable output.
