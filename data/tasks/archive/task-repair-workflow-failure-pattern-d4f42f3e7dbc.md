---
status: done
---

# Repair persistent improver workflow failure pattern

## Problem

The `improver` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:improver:step-error:9dc32dfa2618`
Root-cause fingerprint: `workflow-failure-root:improver:530e767ae782`
Evidence fingerprint: `0069721e78d78d9b951887b6748dc51758a107a37308b5bc1d24b5a0e905bfb1`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: improver
- Failure class: step-error:improve:999e574cf5a4
- Signal: step improve error 999e574cf5a4
- Run ids: 2026-08-03T05-14-19-008Z-improver-cp9dla, 2026-08-03T06-07-24-003Z-improver-uewwcq, 2026-08-03T07-12-05-870Z-improver-8govyg
- Window: 2026-08-03T06:07:16.097Z to 2026-08-03T07:53:34.308Z
- Actionable reason: improver has 3 consecutive failed completed runs with the same owned failure class (step improve error 999e574cf5a4).

- run 2026-08-03T07-12-05-870Z-improver-8govyg failed at step improve: Repair loop for step "improve" made no progress after <n> consecutive attempts. Still failing: commit-message-exists
- run 2026-08-03T06-07-24-003Z-improver-uewwcq failed at step improve: Repair loop for step "improve" made no progress after <n> consecutive attempts. Still failing: commit-message-exists
- run 2026-08-03T05-14-19-008Z-improver-cp9dla failed at step improve: Repair loop for step "improve" made no progress after <n> consecutive attempts. Still failing: commit-message-exists

## Desired Outcome

Repair the local workflow/runtime cause so the same pattern no longer
fires on fresh run artifacts. The fix may live in workflow code, repair
checks, validation, queue shaping, prompts, or local runtime handling, but
it should not hide the signal by broadening infrastructure exclusions
without evidence that the failure is actually outside KOTA's control.

## Constraints

- Use existing `.kota/runs/` metadata and run artifacts as evidence.
- Keep cost and throughput data out of autonomy-agent context.
- Do not create one task per run; keep this task anchored to the stable
  root-cause fingerprint above.
- Preserve provider/auth/rate-limit/timeout exclusions unless the local
  runtime handling is the defect being repaired.

## Product / Safety Link

Persistent monitored workflow failures are a runtime posture blocker:
autonomy cannot reliably ship or review Product/Safety work while this
root cause keeps recurring. This Meta repair is actionable only because
the detector crossed the local-code threshold on concrete run artifacts.

## Done When

- Fresh run artifacts no longer trigger this pattern fingerprint, or the
  threshold/classification is deliberately adjusted with a committed reason.
- Focused tests cover the local cause and the detector behavior that would
  have caught this recurrence.
- Operator-facing attention output still reports future escalations with
  the generated task id and without cost fields.

## Source / Intent

Auto-created by `workflow-failure-escalator` from recent workflow run
metadata. Persistent non-infrastructure workflow failures should become
one evidence-backed repair task instead of remaining only in digests or
improver context.

## Initiative

Autonomy fleet health: recurring local workflow failures should graduate
into deterministic, reviewable repair work.

## Acceptance Evidence

- `a273b8e2d` removed the nested Codex sandbox that prevented agent-authored
  commands from completing inside KOTA's machine-authority boundary;
  `811986419` keeps a failed invoked command recoverable instead of aborting
  the native harness; `4a1de2bc2` preserves terminal repair evidence so future
  recurrences classify as `repair-check:commit-message-exists` rather than an
  opaque step-error fingerprint.
- Fresh detector execution at `2026-08-04T05:20:00.000Z` over the canonical
  `.kota/runs/` store returned `matched: false` for
  `workflow-failure:consecutive-failures:improver:step-error:9dc32dfa2618`
  and no current improver patterns. Later improver run
  `2026-08-03T18-46-08-867Z-improver-dfvsor` completed with a valid
  `commit-message.txt`; `2026-08-03T21-09-24-239Z-improver-w2589l` then
  completed as the explicit no-action path.
- Focused native-harness, sandbox-policy, terminal-repair-evidence,
  failure-detector, and escalator-workflow validation passed: 5 files and 48
  tests. The attention assertions require the generated task id and reject
  cost or throughput fields.

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:improver:step-error:9dc32dfa2618 -->
<!-- workflow-failure-evidence-fingerprint: 0069721e78d78d9b951887b6748dc51758a107a37308b5bc1d24b5a0e905bfb1 -->
