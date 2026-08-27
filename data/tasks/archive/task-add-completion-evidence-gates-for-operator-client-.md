---
status: done
---

# Add completion evidence gates for operator client tasks

## Problem

The completed full CLI client task contained strong acceptance evidence
requirements, but at creation time the code still left the operator with a
shallow readline navigator and a passive daemon dashboard. That meant at least
one operator-client task had reached `done/` without evidence proving the
actual operator journey.

Task policy already says client/channel work needs rendered transcripts,
screenshots, runtime probes, or equivalent artifacts, but the queue tooling
does not reliably gate completion for completed operator-client tasks.

## Desired Outcome

Task validation and task movement should reject operator-facing client,
daemon-control, CLI, setup, approval, owner-request, and workflow-control tasks
that claim completion without concrete rendered/runtime evidence matching
their acceptance criteria.

The gate should be specific enough to catch overclaimed CLI/UI work, but not
so broad that it blocks internal refactors with no user-visible surface.

## Constraints

- Reuse the existing task schema and validator. Do not add a parallel audit
  file, changelog, or lesson surface.
- Do not require expensive build/lint/test commands to validate task evidence.
  The gate can inspect task metadata, sections, and referenced local artifacts.
- Keep accepted evidence kinds aligned with `data/tasks/AGENTS.md`.
- Existing historical done tasks may need explicit repair tasks or documented
  supersession; do not silently mutate history to pass a gate.

## Done When

- `pnpm kota task move <id> done` or queue validation fails for a new
  operator-client task that lacks required rendered/runtime evidence.
- The validator recognizes CLI transcript evidence, dashboard/status
  transcripts, web screenshots/traces, native snapshots/screenshots, and
  daemon route runtime probes.
- At least one regression fixture mirrors the overclaimed full-CLI task shape:
  strong client acceptance criteria but missing evidence.
- Non-client internal refactor tasks remain unaffected.

## Source / Intent

Owner asked on 2026-07-07 to create tasks for everything not properly completed
or legacy. Investigation found `task-make-bare-kota-launch-the-full-daemon-backed-cli-c`
in `done/` even though current CLI behavior does not satisfy its own full TUI
acceptance criteria.

## Initiative

Autonomy quality control for owner-visible product work.

## Product / Safety Link

Prevents repeated false closure of Product tasks that affect CLI, daemon
controls, approvals, owner requests, setup, and workflow supervision.

## Acceptance Evidence

- Validator fixture showing an operator-client task without transcript/runtime
  evidence failing with a clear error.
- Validator fixture showing a valid CLI transcript evidence reference passing.
- Transcript of the task move or validation command demonstrating the new gate.

## Completion Notes

This gate now protects future Product/client closures. The historical full-CLI
overclaim is explicitly reconciled in
`task-make-bare-kota-launch-the-full-daemon-backed-cli-c` and superseded by the
later terminal-client and foreground-daemon repair tasks.

Evidence transcript:
`.kota/runs/2026-07-07T15-50-32-148Z-builder-smt7x7/validation-transcript.txt`.
Criteria verification:
`.kota/runs/2026-07-07T15-50-32-148Z-builder-smt7x7/success-criteria-verified.txt`.
