---
id: task-recover-agy-builder-completion-reliability-from-th
title: Recover AGY builder completion reliability from the zero-success rollout
status: blocked
priority: p1
area: autonomy
task_class: Platform
summary: Reconstruct every failed AGY builder attempt, fix the shared runtime causes, and prove builders can complete without losing or corrupting work.
created_at: 2026-08-07T01:04:32.818Z
updated_at: 2026-08-11T13:06:04.689Z
---

## Problem

The first AGY rollout produced successful review and improver agent steps but
zero successful builder completions. The failed builder runs included repeated
`Individual quota reached` terminal outcomes and native sandbox/cascade errors
while opening worktree Git metadata or executables such as
`node_modules/.bin/vitest`. Some attempts consumed tens of minutes or hours
before failing. The failures were later recovered operationally, but there is
no complete root-cause matrix proving which defects belonged to AGY, KOTA's
native sandbox projection, quota handling, worktree lifecycle, or the task
itself.

Without that analysis, another AGY rollout can preserve the same zero-success
builder behavior while doctor and lightweight agent steps appear healthy.

A fresh Gemini 3.6 Flash canary on 2026-08-07 isolated a second failure class.
The AGY process returned terminal `SUCCESS` after using one tool, but the result
contained neither final response text nor streamed text. At the time, KOTA
preserved that transport success and left workflow checks to detect the missing
work. The same signature failed an improver, a progress reviewer, and
multiple builders, while a security reviewer completed normally through the
same harness. This is not provider quota evidence: the calls returned success,
consumed input and output tokens, and had no quota reset or provider error.

A monitored continuous-autonomy canary then reproduced the behavior on two
unrelated ready tasks. One builder made four one-turn AGY attempts without
creating success criteria or a stageable change. A second builder made two
one-turn attempts and wrote only enough run artifacts to satisfy the build
repair checks; it made no implementation or task transition, so the canonical
pre-commit consistency gate rejected it. The daemon was halted after these two
runs rather than spending the planned three-hour window repeating a proven
failure mode.

## Confirmed Root Cause

The 2026-08-07 adapter investigation reproduced the empty-success failure
outside the workflow. KOTA launched AGY headlessly with closed stdin,
invocation-local settings, `--mode accept-edits`, and AGY's `--sandbox` nested
inside KOTA's machine-authority sandbox. AGY execution modes do not approve
shell commands; unconfigured `run_command` permissions default to an
interactive ask. Headless AGY therefore soft-denied the command, emitted the
tool error, and then emitted terminal `SUCCESS` with no response. KOTA retained
the status event but classified only the terminal status, hiding the denial
from the harness result and repeating it in fresh repair attempts.

This matches AGY's documented contracts:

- `https://antigravity.google/docs/cli/modes` states that execution modes do
  not override `run_command` permission rules.
- `https://antigravity.google/docs/cli/permissions` states that unconfigured
  commands default to `Ask`.
- `https://antigravity.google/changelog` records that headless permission asks
  are intentionally soft-denied with a stderr notice.

The adapter now has one authority boundary: AGY tools are non-interactively
approved inside KOTA's existing filesystem/process/egress sandbox, and AGY's
nested terminal sandbox is not launched. An empty terminal success following a
tool failure is a typed harness error, while a later final response proves that
AGY recovered. A real isolated probe completed `run_command`, `write_to_file`,
and verification in one turn; a second probe confirmed that a write outside
the projected workspace remained blocked by KOTA.

Do not reintroduce nested sandboxing or interactive AGY permission defaults.
The remaining task scope is the historical quota/recovery matrix and durable
full-builder parity evidence required below.

## Monitored Canary Verdict (2026-08-07 to 2026-08-09)

The longer canary disproved AGY readiness for continuous autonomy. Across 210
workflow runs, all six builder runs failed, no builder completed, and no
builder commit reached `main`. The only three commits were task-governance
changes from non-builder workflows. The daemon is stopped and the operator
preset has been restored to `codex`; AGY must not become the global provider
again until this task's lifecycle proof succeeds.

The six builder failures expose four distinct causes:

- Two readiness checks failed because `agy models` required a fresh sign-in.
- A long builder began while its keychain access token was valid for only about
  ten more minutes. Later repair attempts failed authentication after hours of
  work. Interactive readiness at dispatch therefore does not prove unattended
  credentials will survive the builder and repair lifecycle.
- One repair failed with AGY's `conflicting early termination condition`.
  Terminating the local CLI process did not prove that its remote scheduled
  task had quiesced before KOTA launched the next attempt.
- The remaining attempts failed on a provider network error and an invalid
  evidence artifact. Neither produced a completed implementation.

The canary also exposed a KOTA authority-boundary defect. During an active
canonical-checkout improver run, the daemon-owned `.kota` runtime store was
renamed to `.kota.bak`. KOTA's native sandbox protected a few credential files
but allowed an agent with project-root write authority to move the directory
containing the event journal, workflow state, DLQ, claims, and run metadata.
The active run then observed 1,416 tracked deletions and the daemon crashed
while appending to the now-missing event journal. The runtime store has been
restored, but the architecture must separate daemon-owned state from the
minimal run-artifact surface agents are allowed to write. Do not solve this
with another scattered filename blacklist.

Both preserved dirty AGY builder worktrees failed manual review and must not be
merged as proof of parity:

- The recovery worktree invented two historical run ids, encoded a hardcoded
  incident table as product logic, and claimed a successful full builder
  lifecycle despite the run having failed with a dirty worktree, stale claim,
  and open DLQ.
- The configuration-test worktree marked its task done and claimed a required
  checked-in audit artifact that does not exist. It also introduced unrelated
  sandbox workarounds, including skipping a Telegram artifact assertion after
  `EPERM` or `EACCES`, which swallows the behavior the test should verify.

These are representative quality failures, not merely transport failures:
AGY rushed task transitions, asserted absent evidence, fabricated provenance,
and broadened scope to make checks pass. Future parity review must inspect the
actual diff and independently derive acceptance evidence; the builder's own
completion claim is not sufficient.

## Desired Outcome

Reconstruct every AGY builder attempt from the rollout window and assign each
one an evidence-backed terminal cause. Fix the shared runtime paths so an AGY
builder can inspect its allowed workspace, edit only the task scope, run the
declared verification, produce a stageable commit, transition the task, and
cleanly dispose its claim/worktree.

Quota exhaustion must preserve useful work and create one resumable provider
incident rather than repeated builder churn. Ambiguous or partially useful
branches remain reviewable; no failure path may discard uncommitted changes.

## Constraints

- Do not broaden AGY filesystem or process authority merely to make a run pass.
  Git metadata remains read-only to native agents and KOTA owns staging and
  commits.
- Do not classify every failure as provider quota. Separate provider, sandbox,
  adapter/output-contract, verification, repair-loop, and task-quality causes.
- Do not add blind timeouts, fixed retry counts, or automatic work discard.
- Reuse the canonical provider backoff, recovery projection, claim, DLQ, and
  worktree lifecycle mechanisms; do not add AGY-only shadow state.
- Keep daemon runtime state outside agent mutation authority. Grant agents only
  the explicit run-artifact paths they own; do not make all of `.kota`
  writable and do not emulate isolation with a growing denylist.
- A repair attempt may start only after the prior local process and AGY remote
  task are both terminal. Preserve one logical attempt identity across that
  handoff instead of launching overlapping backend work.
- Readiness must cover unattended credential lifetime and renewal across a
  multi-hour builder, not only a successful `agy models` probe at dispatch.
- Audit the final diff for rushed implementation, ignored examples, unrelated
  edits, generated debris, and incomplete verification.

## Done When

- A root-cause table covers every AGY builder attempt in the rollout window,
  including duration, task, terminal error, preserved work, retry/disposition,
  and responsible subsystem.
- The investigation explains whether an empty successful AGY stream means the
  model omitted its required final answer, AGY omitted or changed a stream
  frame, or KOTA failed to collect a valid frame. Evidence must come from the
  real adapter boundary, not from accepting empty output as success.
- Focused fixtures reproduce each KOTA-owned failure class before the fix and
  demonstrate the corrected behavior afterward.
- At least one representative AGY builder run completes the full builder
  lifecycle with a valid commit and task transition.
- The representative run changes the task implementation, not only workflow
  evidence artifacts, and its scoped diff is reviewed for omitted requirements
  and unrelated edits before AGY becomes the global continuous-autonomy
  provider.
- The completed run leaves no active claim, stale worktree, open duplicate DLQ,
  dirty canonical checkout, or provider retry storm.
- A quota failure after useful edits preserves and later resumes the same work
  without restarting from an empty branch.
- An authenticated multi-hour fixture or controlled canary crosses an access
  token expiry boundary and either renews without intervention or stops before
  claiming work; it must not strand a dirty worktree after authentication
  expires.
- Repair waits for remote AGY task termination and cannot reproduce the
  `conflicting early termination condition` overlap.
- An agent running in the canonical checkout cannot rename, remove, or mutate
  daemon-owned workflow state, while its explicitly assigned run artifacts
  remain writable through one documented mechanism.
- Independent review rejects fabricated run ids, absent artifacts, swallowed
  verification errors, unrelated edits, and a task transition unsupported by
  canonical evidence.

## Source / Intent

Owner direction on 2026-08-07: investigate and improve the local evidence of
quota exhaustion and zero successful AGY builder completions before trusting
AGY-backed continuous autonomy.

Representative failures include builder runs ending on provider quota reset
windows and native cascade `operation not permitted` errors against worktree
`.git` metadata and `node_modules/.bin/vitest`. Successful non-builder AGY runs
do not satisfy this task.

The 2026-08-07 canary adds these exact `antigravity_cli_empty_output` runs:

- `2026-08-06T20-54-20-563Z-improver-fapxop`
- `2026-08-06T20-54-21-500Z-progress-reviewer-vcwa2p`
- `2026-08-07T01-10-51-326Z-builder-uqoutb`
- `2026-08-07T01-10-51-326Z-builder-6rjqk8`

Both builder result frames reported AGY `SUCCESS` after one tool call, with
20,641/393 and 20,652/534 input/output tokens respectively, but zero final text
and no changed paths. The same canary's security-review run
`2026-08-06T20-26-33-816Z-security-review-3xna1r` completed through
`gemini-3.6-flash`, proving the binary, authentication, selected model, and
basic stream parser were not universally unavailable.

The later monitored canary adds two stronger builder cases:

- `2026-08-07T01-57-52-891Z-builder-epufuo` invoked Gemini 3.6 Flash four
  times. Every AGY result was a one-turn `SUCCESS` with empty final text. The
  raw events recorded 92,328 input tokens and 3,189 output tokens in total, but
  none of the attempts created success criteria, changed the task, or produced
  a stageable commit. The repair loop stopped after three identical failures.
- `2026-08-07T01-57-52-891Z-builder-9qukof` selected a different task. Its
  initial and repair attempts again ended after one tool call with empty final
  text. The repair wrote workflow artifacts but no implementation or completed
  task transition, and `check-claimed-task-consistency` refused to commit it.

Both runs left zero unique commits and their worktrees were removed without
discarding changes. The first failed run's aggregate metadata reports zero
tokens even though its event stream contains the token counts above; include
failed repair-attempt usage accounting in the incident analysis so future AGY
quality and quota decisions use complete telemetry.

## Initiative

Evidence-gated AGY autonomy rollout.

## Acceptance Evidence

- `.kota/runs/<run-id>/agy-builder-recovery/incident-matrix.json` linking each
  historical run to its evidence and disposition.
- A successful builder run directory containing the AGY event trace, scoped
  diff, verification output, commit, task transition, claim release, worktree
  cleanup, and final recovery projection.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/agy-builder-recovery-live-pass/
description: authenticated trusted-host AGY evidence — export the canonical 2026-08-07 through 2026-08-09 builder run records needed to identify every historical attempt, run the live macOS runtime write-boundary fixture outside a nested agent sandbox, then run a controlled long-lived AGY builder canary with operator-managed login across an access-token expiry boundary and capture the sandbox result, AGY event trace, scoped implementation diff, verification, commit, task transition, claim release, worktree cleanup, DLQ state, and final recovery projection under .kota/runs/agy-builder-recovery-live-pass/
```

## Status (2026-08-11 builder)

Implemented the KOTA-owned lifecycle fixes that can be proven without the
operator's canonical runtime store or AGY login:

- KOTA-owned native sandboxes now protect `.kota` as one structural runtime
  boundary. Only the validated per-invocation `builder-evidence/<run-id>` and
  `tmp/<run-id>` roots remain writable. Deterministic macOS-profile and Linux
  mount-order fixtures cover the boundary construction, but this builder's
  outer sandbox prevents the nested macOS process from starting, so trusted-host
  live mutation-denial proof remains part of the operator-capture blocker.
- AGY cancellation now waits for a terminal remote result before releasing
  native abort quarantine. Missing terminal confirmation fails closed, and
  repair continues the same AGY conversation id rather than creating a fresh
  remote project.
- Builder harness readiness now runs before claim acquisition. AGY's current
  `agy models` response proves present model access but not multi-hour renewal,
  so unattended AGY builders fail before claiming until supported renewal
  evidence exists.
- Repair-loop output aggregates initial and completed repair-call token usage,
  preserves it on terminal repair failures, and records the resumed session id.

Focused harness, workflow, repair accounting, preclaim, and structural sandbox
tests pass, as does TypeScript. The macOS live sandbox fixture reports skipped
when its bootstrap smoke probe is denied; it no longer converts a process that
never started into a passing result. The changed files pass Biome. Repo-wide
Biome reaches only unrelated pre-existing unused-symbol warnings in split
owner-decision and approval-queue tests.

The four run ids named in this task were recorded in this builder's incomplete
incident-matrix artifact with only task-backed facts. The longer canary says six
builders failed but does not expose their run ids, task ids, durations, or
canonical records in the repository, and the sandbox cannot read the daemon's
runtime store. Those rows and the required authenticated successful builder
run were not invented; they are the operator-capture blocker above.
