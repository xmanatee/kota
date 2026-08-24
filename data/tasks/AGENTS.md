# Tasks

This directory is the normalized live work queue after ideas leave `data/inbox/`.

State directories define their own lifecycle contracts. Read the local `AGENTS.md` before touching tasks in a state directory.

State and priority are separate concepts. Priority describes importance; state describes scheduling and lifecycle.

## Task Format

- Use `pnpm kota task create` to scaffold tasks. The scaffold and validator are
  the schema boundary.
- Use `depends_on: [task-id, ...]` as the canonical hard-predecessor representation;
  do not encode hard ordering only in prose. Open tasks may name only existing,
  non-dropped immediate predecessors; omit transitively implied edges.
- If a blocked task uses an `## Unblock Precondition` of `kind: task-done`,
  its `depends_on` list must be exactly the same task id.
- Tasks describe what must become true and why it matters; builders own the
  plan. Runtime replacements follow the proof contract in the repo-tasks module.
- Every open task sets `task_class: Product`, `Safety`, `Platform`, or `Meta`
  in frontmatter. Product is owner-visible capability or UX; Safety is
  security, credential, permission, policy, or destructive-action risk;
  Platform is enabling architecture/runtime/protocol work; Meta is work on the
  autonomous process, evaluators, repair loops, prompts, or queue machinery.
- Replace generated autonomy-issue placeholder text with a concrete behavioral
  `## Desired Outcome` before the proposal enters the open queue.
- Preserve owner wording, runtime evidence, research source, and urgency in
  `## Source / Intent`; do not normalize away the reason the task exists.
- `## Acceptance Evidence` names the transcript, screenshot, fixture, command,
  artifact, or demo that proves the task's outcome. User-facing CLI/UI work
  needs rendered-output evidence, not only implementation tests.
- Keep central research and decision refs visible in `## Source / Intent` or decision
  sections. Cite watchlist refs instead of copied metadata; record access blockers.

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
`## Desired Outcome` or `## Done When` must name one of those artifact kinds in
`## Acceptance Evidence`. Completion has the same bar: Product tasks targeting
CLI, daemon control, setup/auth, approvals, owner requests, workflow control,
dashboard/status, or another operator client may not move to `done/` without
inspectable rendered/runtime proof. The validator enforces this as
`client-task-missing-rendered-evidence` or
`done-operator-client-missing-rendered-evidence`; prose substitutes and
implementation tests alone do not satisfy either gate.

Per surface, accepted artifact kinds:

- macOS / iOS / native: projected PNG under `.kota/runs/<run-id>/evidence/artifacts/`, or a rendered Swift snapshot fixture committed alongside the test.
- Mobile (React Native / web): rendered DOM fixture or projected PNG under `.kota/runs/<run-id>/evidence/artifacts/`.
- Web dashboard: projected PNG or screened HTML report under `.kota/runs/<run-id>/evidence/artifacts/`.
- CLI: full transcript captured to `.kota/runs/<run-id>/evidence/artifacts/transcript.txt`
  showing the command, arguments, and output (with secrets redacted).
- Telegram / Slack: rendered message fixture (JSON or markdown) checked in
  with the test, or a projected PNG of the actual conversation under
  `.kota/runs/<run-id>/evidence/artifacts/`.
- Daemon route: a runtime probe (`## Runtime Probe` task section, see
  `src/modules/autonomy/workflows/builder/AGENTS.md`) or a transcript of the
  curl invocation in the run directory.

If the artifact requires a credential enrollment, approval, physical action,
or external environment that only an operator controls, document an explicit
operator-capture precondition in the task — either inline in
`## Acceptance Evidence` or by moving the task to `blocked/` with an
`operator-capture` precondition. A builder-agent sandbox limitation is not an
operator precondition when the trusted host can run the evidence command as a
Runtime Probe. Internal refactors that do not change visible behavior remain
exempt; pick a non-client area (`architecture`, `core`, `modules`, ...) for
those.

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
- P1 Product and Safety work outranks Meta/repair work unless the runtime is broken.
  Actionable Meta tasks must name the Product or Safety blocker they close in
  `## Product / Safety Link`; otherwise they belong outside the actionable queue.
- Use `pnpm kota task move <id> <state>` to move tasks between state directories. The move command owns lifecycle metadata and file movement.
- Before finishing, ensure task validation would pass: unique ids, tracked task
  files, no stale deletes, and matching status/directories.

## Blocked Tasks

Every task in `data/tasks/blocked/` must declare exactly one `## Unblock
Precondition` using the typed vocabulary enforced by the validator:

- `task-done` — promote when the referenced enabler task is in `done/`.
- `capability-installed` — promote when the deterministic local capability
  probe is satisfied (`playwright` or `storageState:<path>`).
- `owner-decision` — re-ask through blocked-promoter on the 14-day cadence; promote only after the workflow writes a resolved marker.
- `operator-capture` — promote when the named evidence file exists, or when its
  directory contains operator-visible proof; use only for evidence requiring
  operator-controlled credentials, approval, physical action, or an external
  environment. Preflight/smoke-only directories stay blocked and refresh the
  14-day marker.

Do not use `blocked/` as a parking lot. If a blocked task has been reviewed,
move/drop/rescope it or refresh the exact action marker. Queue validation emits
`blocked-task-stale` after the stale threshold without a fresh owner ask or operator-capture instruction marker.
