---
id: task-warn-before-native-cli-harness-auth-expires-during
title: Warn before native CLI harness auth expires during long-running autonomy
status: ready
priority: p2
area: architecture
task_class: Platform
summary: Surface expiring harness-managed native CLI login state in preset readiness, doctor, and workflow artifacts so unattended Codex, Claude, Gemini CLI, or Antigravity runs fail preflight or warn before background sessions are interrupted.
created_at: 2026-07-08T06:16:15.721Z
updated_at: 2026-07-08T06:16:15.721Z
---

## Problem

KOTA's preset and harness readiness model now distinguishes env-auth,
harness-managed local auth, missing login, errors, and unverifiable native CLI
auth. It still has no way to represent a login that is currently usable but
near expiry or already stale according to locally observable CLI/cache
metadata.

That gap matters for long-running autonomous work. A native CLI harness can
pass a local readiness check, start a headless workflow agent step, and then
lose its provider session while a background run, hook, or worker is still
active. Operators discover the problem only after the workflow fails, often
after consuming context and leaving a task claim or run recovery path to clean
up.

KOTA already has pieces of the evidence but not the contract. For example,
`geminiCliAuthReadiness()` reads `~/.gemini/oauth_creds.json` and understands
`expiry_date`, while `probeNativeCliAuth()` classifies command output as ready
or missing. Neither path can surface "ready, but re-authenticate soon" through
`kota doctor`, preset-readiness JSON, or workflow harness-capability artifacts.

## Desired Outcome

Native CLI harness auth readiness can report expiring or stale local login
state before an unattended workflow run depends on it. The result should make a
near-expiry token visible to the operator without turning default readiness
into a live provider call.

The first slice should cover the shared readiness contract plus at least one
real adapter:

- the agent-harness readiness type can carry an auth expiry warning or
  equivalent discriminated state with a redacted `expiresAt` / renewal summary;
- preset readiness aggregation treats the warning intentionally: visible in
  doctor and artifacts, not silently coerced to clean ready or hard failure;
- `gemini-cli` maps cached OAuth credentials with an expired access token and
  no refresh token to missing/stale auth, and maps near-expiry non-refreshable
  credentials to an operator warning;
- native CLI auth-status probes can classify provider output that explicitly
  says login will expire soon when a CLI exposes that fact; and
- workflow agent-step capability artifacts include the warning so a failed or
  skipped run explains that the auth boundary was already near expiry.

## Constraints

- Keep ordinary readiness local and non-networked. Do not make `doctor`,
  preset-readiness collection, or harness-capability snapshots perform a live
  model/provider call.
- Do not inspect private keychains, cookies, browser profiles, or undocumented
  credential stores. Use only the CLI's supported status command or documented
  cache files already read by the adapter.
- Do not misclassify refreshable credentials as urgent just because an access
  token has a short expiry. A stored refresh token can remain ready unless the
  adapter has evidence refresh is unavailable.
- Preserve `unverifiable` for Antigravity-style auth where no supported
  headless status exists. Do not downgrade unverifiable auth to expiring from
  guesswork.
- Redact account identifiers and credential file contents in all operator
  output and artifacts.
- Keep module setup/auth requirements separate from harness-managed local CLI
  auth. This task extends harness readiness; it does not add a second setup
  registry.

## Done When

- `AgentHarnessAuthProbe` or its readiness summary can represent expiring or
  stale-but-locally-observable auth without overloading `ready`, `missing`,
  `error`, or `unverifiable`.
- Preset readiness aggregation and `isPresetHarnessReadinessReady()` define
  exactly whether expiring auth is pass-with-warning or fail, and tests cover
  that choice.
- `kota doctor --preset <native-cli-preset> --skip-connectivity` renders an
  expiring-auth warning with the renewal action and redacted detail.
- Harness capability snapshots written for workflow agent steps and
  harness-parity runs preserve the auth warning in structured JSON.
- `geminiCliAuthReadiness()` has focused tests for: valid refresh token,
  unexpired non-refreshable access token, near-expiry non-refreshable access
  token, expired non-refreshable access token, malformed cache, and missing
  cache.
- `probeNativeCliAuth()` or an adapter-owned parser has focused tests for a
  fake CLI status output that reports near-expiry login, while existing Codex
  missing/API-key-only behavior stays unchanged.
- No default readiness path makes a provider network call.

## Source / Intent

Explorer run `2026-07-08T06-04-06-878Z-explorer-ggkk1a` reviewed an empty
dispatchable queue. The only ready task is blocked by a pending-merge claim,
the OpenRouter rollout backlog task is dependency-blocked, and every surfaced
strategic blocked alternative still requires operator-captured evidence rather
than a code-side promotion:

- `task-extend-harness-parity-and-eval-harness-with-model-`
- `task-add-a-cross-hierarchy-signal-flow-debugging-fixtur`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-algorithmic-resource-budget-canaries-to-the-ev`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External watchlist signal checked:

- `https://github.com/anthropics/claude-code/releases` shows Claude Code
  v2.1.203 adding a warning before login expiry interrupts background
  sessions and fixing stale daemon session-token recovery for background
  sessions. v2.1.204 then fixes SessionStart hook event streaming in headless
  sessions so remote workers are not idle-reaped mid-hook. The KOTA-relevant
  signal is not importing Claude Code's session model; it is that long-running
  native/headless agent runners need locally visible auth/session-health
  warnings before a background run fails.

Local overlap check:

- `task-add-preset-harness-readiness-reporting` already reports runtime and
  auth readiness, but it predates expiring-auth semantics.
- `task-represent-unverifiable-native-cli-auth-without-fai` separates
  unverifiable native auth from missing auth for Antigravity; it does not
  model near-expiry or stale local login.
- `task-record-agent-step-sandbox-capability-snapshots-in-workflow-artifacts`
  writes readiness/capability artifacts for normal workflow runs, but it can
  only serialize the states the readiness model exposes.
- `task-add-module-setup-and-auth-requirement-protocol` covers module setup and
  OAuth lifecycle, not harness-managed native CLI login state.

## Initiative

Harness-preset migration and autonomous run reliability: native CLI harnesses
should fail or warn before unattended work depends on expiring local login
state.

## Acceptance Evidence

- Focused test transcript covering readiness types, preset aggregation, doctor
  rendering, Gemini CLI cache parsing, and native CLI expiry-output parsing.
- A redacted `kota doctor --preset gemini-cli --skip-connectivity` fixture or
  transcript showing an expiring-auth warning from fake local cache data.
- A workflow or harness-parity capability artifact fixture showing the same
  auth warning preserved in structured JSON without credential contents.
- `pnpm run validate-tasks` passes with this ready task present.
