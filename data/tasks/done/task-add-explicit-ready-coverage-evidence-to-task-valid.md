---
id: task-add-explicit-ready-coverage-evidence-to-task-valid
title: Add explicit ready-coverage evidence to task validation output
status: done
priority: p2
area: autonomy
summary: Make task queue validation emit inspectable ready-coverage evidence so completion transcripts prove the selected queue contains strategic actionable work.
created_at: 2026-05-26T21:21:55.505Z
updated_at: 2026-05-26T22:02:44Z
---

## Problem

`pnpm run validate-tasks` exits silently on success. That is fine for a
machine gate, but it makes completion evidence weak when a task specifically
needs to prove ready-queue coverage: a transcript can show exit 0 without
showing whether `data/tasks/ready/` contained any `p0`/`p1`/`p2` work.

Builder run `2026-05-26T21-05-09-277Z-builder-pant8u` hit this ambiguity. The
implementation fixed the explorer strategic-ready gap, but the critic could
not accept the validation transcript as evidence because the final ready queue
was empty and the transcript only showed the default success path.

The validation boundary already supports stricter checks such as
`--min-ready`; the operator-facing evidence should make the checked queue shape
inspectable instead of relying on reviewers to infer it from surrounding file
state.

## Desired Outcome

Task queue validation can produce a concise success summary that names ready
count and strategic-ready coverage status, so run artifacts can prove both
schema validity and selected-work coverage.

The default validation gate may stay quiet if that is the existing contract,
but there should be a documented command path suitable for completion
evidence. That path should make an empty ready queue, a p3-only ready queue,
and a ready queue with strategic work visibly different in the transcript.

## Constraints

- Do not make intentionally empty queues globally invalid; empty queue handling
  is workflow policy, not a universal task-file schema rule.
- Keep `--min-ready` and `assertStrategicReadyCoverage` semantics strict.
- Prefer extending the existing `validate-queue` / repo-tasks validation path
  over adding a second queue inspection script.
- Keep output concise enough for run artifacts and operator reports.

## Done When

- A validation command intended for run artifacts prints ready count and
  strategic-ready coverage status on success.
- The command can be combined with `--min-ready 1` so a transcript proves at
  least one ready task exists.
- Focused coverage proves the success summary distinguishes empty ready,
  p3-only ready, and strategic ready states without relaxing existing failure
  checks.

## Source / Intent

Post-check critic for builder run
`2026-05-26T21-05-09-277Z-builder-pant8u` rejected the previous completion
because `data/tasks/ready/` was empty and the `validate-tasks` transcript only
showed exit 0. The immediate repair keeps a p2 task in `ready/`; this follow-up
removes the evidence ambiguity so future completions can prove the queue shape
directly.

## Initiative

Autonomous queue quality: completion evidence should prove selected-work
coverage instead of depending on reviewer reconstruction.

## Acceptance Evidence

- Focused repo-tasks or validate-queue test output covering the three ready
  states.
- A transcript of the new evidence command showing ready count and
  strategic-ready coverage status, including a passing `--min-ready 1` case.
