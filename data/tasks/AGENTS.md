# Tasks

This directory is the normalized live work queue after ideas leave
`data/inbox/`. State directories define their lifecycle boundaries; read the
nearest `AGENTS.md` before changing a task.

## Task contract

- Use the task command to create and move tasks. The repo-tasks domain owns
  identifiers, safe paths, lifecycle states, dependencies, and mutation
  authorization.
- Tasks usually state `Problem`, `Desired Outcome`, `Constraints`, and `How We
  Will Know`. These are authoring prompts, not validator-required keywords;
  natural prose is valid when it preserves the same intent. Builders own the
  implementation plan.
- Preserve owner wording, observed runtime evidence, research provenance, and
  urgency. Do not normalize away why the task exists.
- Represent hard predecessors with `depends_on`; do not duplicate ordering in
  prose or add transitive edges.
- Choose the strongest proportionate observation for the outcome. A live
  journey may be useful for operator-facing work and a focused behavior check
  may be sufficient for an internal change, but task labels never prescribe a
  fixed artifact, filename, or test category.
- Task metadata helps routing and prioritization. It must not turn preferences,
  reviewer judgment, or implementation details into mechanical completion
  gates.

The scaffold and validator remain the machine-readable format authority. Do
not copy their field catalogs or accepted-value lists into instructions.

- If a blocked task uses an `## Unblock Precondition` of `kind: task-done`,
  its `depends_on` list must be exactly the same task id.
- Every open task sets `task_class: Product`, `Safety`, `Platform`, or `Meta`
  in frontmatter. Product is owner-visible capability or UX; Safety is
  security, credential, permission, policy, or destructive-action risk;
  Platform is enabling architecture/runtime/protocol work; Meta is work on the
  autonomous process, evaluators, repair loops, prompts, or queue machinery.
- Replace generated autonomy-issue placeholder text with a concrete behavioral
  `## Desired Outcome` before the proposal enters the open queue.
- `## Acceptance Evidence` may name proportionate proof when that helps the
  builder understand the outcome. It is guidance, not a prose-parsing runtime
  gate; the critic judges the actual result and available evidence.
- Keep central research and decision refs visible in `## Source / Intent` or decision
  sections. Cite watchlist refs instead of copied metadata; record access blockers.

An anchor tracks a multi-stage initiative whose outcome is achieved by its
owned slices. Keep it in backlog as a progress and decision record; do not
dispatch it as a builder-sized task. Update stage state and ownership as work
lands, and remove obsolete tracked slices rather than preserving a historical
inventory.

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

## Blocked work

Blocked tasks name one concrete external precondition that can be evaluated
without reinterpreting the whole task: completion of a prerequisite, local
capability availability, an owner decision, or an operator-only action. The
state owner defines the typed representation.

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
