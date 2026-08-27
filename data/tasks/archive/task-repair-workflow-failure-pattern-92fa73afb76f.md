---
status: done
---

# Repair persistent builder workflow failure pattern

## Problem

The `builder` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:builder:step-error:461d22ce1c9d`
Root-cause fingerprint: `workflow-failure-root:builder:755974f7ce02`
Evidence fingerprint: `792a2ea174c508654d7404aca8db84c20e9ece3f936577771b6277d44566b05a`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: builder
- Failure class: step-error:build:a46a4e99c75a
- Signal: step build error a46a4e99c75a
- Run ids: 2026-08-05T07-44-46-927Z-builder-pw8ksf, 2026-08-05T09-27-20-187Z-builder-wdogj9, 2026-08-05T09-30-00-755Z-builder-g8c6ll, 2026-08-05T09-30-00-755Z-builder-bpl336
- Window: 2026-08-05T09:28:04.465Z to 2026-08-05T09:30:49.822Z
- Actionable reason: builder has 4 consecutive failed completed runs with the same owned failure class (step build error a46a4e99c75a).

- run 2026-08-05T09-30-00-755Z-builder-bpl336 failed at step build: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-30-00-755Z-builder-g8c6ll failed at step build: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-27-20-187Z-builder-wdogj9 failed at step build: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T07-44-46-927Z-builder-pw8ksf failed at step build: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.

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

- Commit `1aa26b0d` restored fail-closed native `scopePolicy` execution instead
  of rejecting every Codex workflow at preflight; commit `5b68d01af` completed
  the native sandbox and credential boundary.
- The focused workflow-failure, event-journal, scope-policy, and sandbox command
  recorded above passed 32 checks, including duplicate suppression and
  cost-free operator-attention formatting.
- The superseded failure set was isolated by exact error class before DLQ
  dismissal; a fresh builder run is used as the live post-reload verification.

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:builder:step-error:461d22ce1c9d -->
<!-- workflow-failure-evidence-fingerprint: 792a2ea174c508654d7404aca8db84c20e9ece3f936577771b6277d44566b05a -->
