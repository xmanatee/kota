---
id: task-recover-agy-builder-completion-reliability-from-th
title: Recover AGY builder completion reliability from the zero-success rollout
status: ready
priority: p1
area: autonomy
task_class: Platform
summary: Reconstruct every failed AGY builder attempt, fix the shared runtime causes, and prove builders can complete without losing or corrupting work.
created_at: 2026-08-07T01:04:32.818Z
updated_at: 2026-08-07T15:26:57Z
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
