# Tasks

This directory is the normalized live work queue after ideas leave
`data/inbox/`.

State directories define their own lifecycle contracts. Read the local
`AGENTS.md` before touching tasks in a state directory.

State and priority are separate concepts. Priority describes importance; state
describes scheduling and lifecycle.

## Task Format

- Use `pnpm kota task create` to scaffold tasks. The scaffold and validator are
  the schema boundary.
- Tasks describe what must become true and why it matters; builders own the
  implementation plan.
- Preserve owner wording, runtime evidence, research source, and urgency in
  `## Source / Intent`; do not normalize away the reason the task exists.
- `## Acceptance Evidence` names the transcript, screenshot, fixture, command,
  artifact, or demo that proves the task's outcome. User-facing CLI/UI work
  needs rendered-output evidence, not only implementation tests.
- Keep required research links visible when they are central to the work. If
  source access fails, record the blocker honestly instead of treating the task
  as complete.

## Strategic Anchor Tasks

A task may declare itself a strategic anchor by setting `anchor: true` in its
frontmatter. Anchors track an initiative across a sequenced set of sub-slice
tasks; their `Done When` is met by completing the sub-slices, not by
implementing the anchor as a single block. The backlog-promoter skips anchor
tasks, so they stay in `backlog/` as tracking records and never land in
`ready/`. Use the anchor flag only when decomposition is complete and the
sub-slice tasks exist in the queue.

## Acceptance Evidence For Client And Channel Work

`area: client` and `area: channel` tasks that declare a screenshot, screencast,
rendered artifact/fixture, transcript, runtime probe, or visual evidence in
their `## Desired Outcome` or `## Done When` must also name at least one of
those artifact kinds in `## Acceptance Evidence`. The validator enforces this
as `client-task-missing-rendered-evidence`. Prose substitutes ("branch
description covers the visual change", "implementation tests pass") do not
satisfy the gate.

Per surface, accepted artifact kinds:

- macOS / iOS / native: PNG/screencast under `.kota/runs/<run-id>/`, or a
  rendered Swift snapshot fixture committed alongside the test.
- Mobile (React Native / web): rendered DOM or screenshot fixture, or a video
  capture under `.kota/runs/<run-id>/`.
- Web dashboard: screenshot under `.kota/runs/<run-id>/`, or a Playwright
  trace/HTML report.
- CLI: full transcript captured to `.kota/runs/<run-id>/transcript.txt`
  showing the command, arguments, and output (with secrets redacted).
- Telegram / Slack: rendered message fixture (JSON or markdown) checked in
  with the test, or a screenshot of the actual conversation under
  `.kota/runs/<run-id>/`.
- Daemon route: a runtime probe (`## Runtime Probe` task section, see
  `src/modules/autonomy/workflows/builder/AGENTS.md`) or a transcript of the
  curl invocation in the run directory.

If the artifact must be captured by an operator (no headless capture path
exists), document an explicit operator-capture precondition in the task —
either inline in `## Acceptance Evidence` or by moving the task to
`blocked/` with an `operator-capture` precondition. Internal refactors that
do not change visible behavior remain exempt; pick a non-client area
(`architecture`, `core`, `modules`, ...) for those.

## Queue Rules

- New rough ideas belong in `data/inbox/`.
- Prefer substantive work over repeated split, rename, dedup, or test-only
  cleanup tasks.
- Keep the queue pointed at module-first/core-shrinking work while visible
  architecture debt remains.
- Before creating a task, scan open tasks and related inbox items for overlap.
- Prefer coherent batches or one substantive task over isolated mechanical
  move/import/test-only work. If cleanup is needed, attach it to the broader
  initiative it enables.
- Owner-facing regressions, broken operator output, repeated expensive
  failures, and stale blocked owner requests are strong queue-shaping signals.
- Use `pnpm kota task move <id> <state>` to move tasks between state directories.
  The move command owns lifecycle metadata and file movement.
- Before finishing, ensure task validation would pass: unique ids, tracked task
  files, no stale deletes, and matching status/directories.

## Blocked Tasks

Every task in `data/tasks/blocked/` must declare exactly one `## Unblock
Precondition` using the typed vocabulary enforced by the validator:

- `task-done` — promote when the referenced enabler task is in `done/`.
- `capability-installed` — promote when the deterministic local capability
  probe is satisfied (`playwright` or `storageState:<path>`).
- `owner-decision` — re-ask through blocked-promoter on the 14-day cadence and
  promote only after the workflow writes a resolved marker.
- `operator-capture` — promote when the named evidence path exists; until then,
  blocked-promoter refreshes an instruction marker on the 14-day cadence.

Do not use `blocked/` as a parking lot. If a blocked task has been reviewed,
move/drop/rescope it or refresh the exact action marker. Queue validation emits
`blocked-task-stale` when a blocked task ages past the stale threshold without
a fresh owner ask or operator-capture instruction marker.
