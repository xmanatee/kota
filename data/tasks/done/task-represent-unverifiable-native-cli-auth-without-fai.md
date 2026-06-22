---
id: task-represent-unverifiable-native-cli-auth-without-fai
title: Represent unverifiable native CLI auth without failing preset readiness
status: done
priority: p2
area: architecture
task_class: Platform
summary: Distinguish harness-managed auth that cannot be checked non-interactively from missing auth, so Antigravity CLI doctor and preset-parity preflight stay honest while still allowing an explicit operator-invoked live smoke.
created_at: 2026-06-22T04:43:07.804Z
updated_at: 2026-06-22T05:00:19.000Z
---

## Problem

KOTA's preset-readiness contract currently models harness-managed local auth as
`ready`, `missing`, or `error`. That works for Codex and Gemini CLI, which have
usable local auth probes, but it does not fit Antigravity CLI: `agy` stores
Google login state in the OS secure keyring and the adapter has no documented
headless auth-status command to call.

The current Antigravity adapter therefore returns
`localAuth.status: "missing"` from `antigravityCliAuthReadiness()` even when the real CLI may be
usable. The blocked cross-preset parity task records exactly that split:
`doctor --preset antigravity-cli --skip-connectivity` remains conservative
because auth cannot be verified non-interactively, while a live
`agy --print "Reply with exactly: ok"` smoke returned `ok` on the same host.

Treating "unverifiable" as "missing" makes doctor and preset-parity preflight
look like a login failure instead of an explicit evidence limitation. Treating
it as "ready" would be worse, because KOTA would claim knowledge it does not
have. The missing state is a third state: local runtime is present, auth cannot
be checked without a live AGY execution, and any live smoke must be an explicit
operator-invoked connectivity check rather than the default readiness probe.

## Desired Outcome

KOTA represents harness-managed auth that cannot be checked non-interactively
as a distinct typed state or equivalent typed diagnostic, separate from both
missing auth and provider/runtime errors.

For `antigravity-cli`:

- default readiness remains local and non-networked;
- `kota doctor --preset antigravity-cli --skip-connectivity` reports the AGY
  binary/version and an explicit "auth unverifiable" or equivalent warning,
  not a failed "not logged in" claim;
- preset-parity preflight and harness-capability artifacts preserve the same
  diagnostic without silently passing or failing the preset as auth-ready;
- an optional operator-invoked connectivity smoke can run a bounded
  `agy --print` probe and record its result separately from local auth
  readiness; and
- actual agent steps still fail loudly if AGY cannot execute.

## Constraints

- Do not inspect Antigravity's OS keyring, browser profile, cookies, or private
  settings to infer login state.
- Do not make the default readiness/capability snapshot perform a provider call
  or launch a live agent turn. Keep local readiness cheap and deterministic.
- Do not weaken Codex or Gemini CLI auth handling. A supported auth-status
  probe that reports missing login must still fail readiness.
- Do not mark Antigravity preset readiness as fully ready unless the evidence
  actually proves both required runtime and required auth/execution status.
- Preserve the current Antigravity capability boundary: native tool control,
  no KOTA `canUseTool`, no KOTA-owned approvals, no KOTA MCP injection, and
  loud rejection for unsupported run options.
- Keep the change in the owning layers: auth/readiness types in the agent
  harness or preset-readiness boundary, AGY-specific facts in
  `src/modules/antigravity-cli-agent-harness/`, and rendering in doctor or
  preset-parity surfaces.

## Done When

- The agent-harness readiness type system can express "auth unverifiable" (or
  an equivalent discriminated state) without overloading `missing` or `error`.
- `antigravityCliAuthReadiness()` uses that state for the documented no
  headless auth-status case, including the settings-file/keyring diagnostic
  without secret leakage.
- `collectPresetHarnessReadiness()` and `isPresetHarnessReadinessReady()` treat
  the new state intentionally: it is visible to operators and preflight
  consumers, not silently coerced to ready or missing.
- `kota doctor --preset antigravity-cli --skip-connectivity` renders a warning
  or typed diagnostic explaining that auth is unverifiable non-interactively,
  while still showing runtime and unsupported-option details.
- If a live AGY smoke path is added, it is explicitly connectivity-scoped,
  timeout-bounded, redacted, and tested with fake CLI output. It does not run
  during ordinary readiness capture.
- Focused tests cover Codex/Gemini missing-auth behavior, Antigravity
  unverifiable-auth behavior, doctor rendering, preset-readiness readiness
  aggregation, and harness-capability artifact serialization if the artifact
  shape changes.

## Source / Intent

Created by explorer run `2026-06-22T03-02-11-232Z-explorer-zj9wpv`.
The queue had one actionable `p3` ready task, no backlog, and
`inspect-queue.strategicReadyCoverageGap=true`, so the run needed a strategic
`p0`/`p1`/`p2` ready task instead of more cleanup.

The strategic blocked alternatives all still require operator-captured
artifacts and were not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-an-unfamiliar-language-strategy-construction-f`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

This task decomposes a code-side gap from
`task-add-cross-preset-runtime-parity-gate` rather than trying to satisfy its
operator-capture precondition. That blocked task's 2026-06-15 audit says
`kota doctor --preset antigravity-cli` fails because AGY auth cannot be
verified non-interactively, while a live `agy --print "Reply with exactly:
ok"` smoke test returned `ok`.

Local overlap check:

- `task-add-antigravity-cli-harness-migration-path-for-gem` already shipped the
  Antigravity CLI harness and preset, including the current conservative auth
  probe.
- `task-record-agent-step-sandbox-capability-snapshots-in-workflow-artifacts`
  already writes readiness/capability evidence for workflow agent steps, but it
  records the current readiness states rather than fixing this auth-state
  model.
- `task-add-cross-preset-runtime-parity-gate` already owns the full live
  all-preset transcript requirement and remains blocked on operator capture.
  This task only fixes the misleading local preflight/auth classification that
  the blocker exposed.

## Initiative

Harness-preset migration: KOTA should make native CLI preset readiness honest
and useful without pretending it can inspect provider-owned local login state.

## Acceptance Evidence

- Focused test transcript for the readiness and doctor paths, for example:
  `pnpm test src/core/agent-harness/readiness.test.ts src/core/model/preset-readiness.test.ts src/modules/doctor/doctor.test.ts src/modules/antigravity-cli-agent-harness/adapter.test.ts`.
- A `kota doctor --preset antigravity-cli --skip-connectivity` transcript under
  `.kota/runs/<run-id>/` showing runtime details, unsupported-option details,
  and the new explicit unverifiable-auth diagnostic.
- If a live smoke command is added, a fake-CLI test and a redacted transcript
  proving the smoke result is recorded separately from local auth readiness.
- `pnpm run validate-tasks` passes with this ready task present.

## Completion Evidence

- Builder run: `.kota/runs/2026-06-22T04-52-55-585Z-builder-a6e07a/`.
- Focused tests passed: `pnpm test src/core/agent-harness/readiness.test.ts src/core/model/preset-readiness.test.ts src/modules/doctor/doctor.test.ts src/modules/antigravity-cli-agent-harness/adapter.test.ts src/core/workflow/steps/step-executor-agent-capability.test.ts`.
- Typecheck passed: `pnpm run typecheck`.
- Build passed: `pnpm run build`.
- Task validation passed after staging the manual task-state move:
  `pnpm run validate-tasks`.
- Doctor evidence:
  `.kota/runs/2026-06-22T04-52-55-585Z-builder-a6e07a/doctor-antigravity-cli-transcript.txt`
  and
  `.kota/runs/2026-06-22T04-52-55-585Z-builder-a6e07a/doctor-antigravity-cli-json-transcript.txt`.
- No live AGY smoke path was added; ordinary readiness remains local and
  deterministic.
