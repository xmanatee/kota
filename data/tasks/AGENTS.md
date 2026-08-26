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
- `## Acceptance Evidence` may name proportionate proof when that helps the
  builder understand the outcome. It is guidance, not a prose-parsing runtime
  gate; the critic judges the actual result and available evidence.
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
- Authored priority is the queue order. Task class and prose provide context
  but do not gate or reorder execution.
- Use `pnpm kota task move <id> <state>` to move tasks between state directories. The move command owns lifecycle metadata and file movement.
- Before finishing, ensure task validation would pass: safe task paths, unique
  ids, valid metadata and dependencies, and matching status/directories.

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
move, drop, or rescope it through the task lifecycle command.
