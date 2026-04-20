---
id: task-surface-long-blocked-tasks-individually-in-the-att
title: Surface long-blocked tasks individually in the attention digest
status: done
priority: p2
area: autonomy
summary: Attention digest reports a bare count of blocked tasks; add per-task surfacing for entries blocked longer than a configured age so operators notice stale blockers that need owner input
created_at: 2026-04-20T20:36:01.772Z
updated_at: 2026-04-20T21:24:46.239Z
---

## Problem

`src/modules/autonomy/workflows/attention-digest/step.ts` emits one
"Blocked backlog" item whenever `blockedCount >= 2`. The detail is a bare
count (`"3 blocked tasks"`). A task that has been blocked for two days
waiting on an owner decision looks identical in the digest to a task that
moved to `blocked/` an hour ago. Operators end up noticing stale blockers
only by scanning `data/tasks/blocked/` directly, which is exactly the
surface the attention digest exists to replace.

The current queue makes the gap visible:
`task-surface-project-selection-in-operator-clients-for-` in
`data/tasks/blocked/` has been blocked since 2026-04-18 pending an owner
decision between Variant A and Variant B. No digest signal distinguishes
it from the other two blocked tasks, and it is the only one whose next
move requires owner attention rather than agent work. The digest should
surface that specifically so the decision does not sit forever.

## Desired Outcome

The attention digest separates "blocked count" from "long-blocked tasks",
so operators can see at a glance which specific entries have been stuck
past a threshold.

- A task is considered long-blocked when the `updated_at` frontmatter is
  older than a configured threshold. The threshold is a named constant in
  `step.ts` (starting at 3 days) overridable by
  `KOTA_DIGEST_BLOCKED_AGE_DAYS`, matching the existing
  `KOTA_DIGEST_WARNINGS_*` knob pattern.
- Each long-blocked task becomes its own `AttentionItem` whose `detail`
  names the task id and how long it has been blocked. The existing bare
  "Blocked backlog" count item stays for operators who want aggregate
  pressure, but is suppressed when every blocked task is long-blocked so
  the digest does not double-count.
- A `blocked/` task whose body explicitly calls out an awaiting owner
  decision (a `## Blocker` section mentioning "owner") is labeled
  differently in the digest so an operator can see "Owner decision
  pending on X" distinctly from "Stale blocker Y".

## Constraints

- Keep all age-parsing logic inside
  `src/modules/autonomy/workflows/attention-digest/` or a small helper
  exported from `src/modules/repo-tasks/`. Do not reach into task files
  from the digest step directly — go through `repo-tasks-domain.ts` so
  the frontmatter-reading surface stays single-sourced.
- Do not add a parallel blocked-task list file, cache, or sidecar. Read
  task frontmatter on demand inside the digest step. Blocked counts are
  small (single digits) so per-run I/O cost is negligible.
- Preserve existing digest cadence: `DIGEST_EVERY_N_RUNS` governs when a
  digest is emitted, and the new items must emit through the same
  `workflow.attention.digest` event, not a second channel.
- No cost signals, model-hint metadata, or LLM input leaks into the
  digest. The step stays a pure code computation.
- Keep the digest message compact. If more than five tasks would be
  listed individually, collapse the tail into a summary line so a digest
  cannot balloon into a wall of text.
- Do not hardcode the awaiting-owner detection to a specific task id or
  a specific owner-question id. Detect via `## Blocker` section presence
  and the word "owner" in that section.

## Done When

1. `src/modules/autonomy/workflows/attention-digest/step.ts` emits a
   per-task `AttentionItem` for each blocked task older than the
   configured threshold, capped at five individual items with a tail
   summary when exceeded.
2. A blocked task whose `## Blocker` section mentions "owner" is labeled
   separately (for example, "Owner decision pending") so the operator
   can distinguish it from a generic stale blocker.
3. The existing aggregate "Blocked backlog" line is suppressed when
   every blocked task is surfaced individually, so the digest does not
   report the same tasks twice.
4. `KOTA_DIGEST_BLOCKED_AGE_DAYS` overrides the default threshold, and
   the default constant lives next to `DEFAULT_WARNINGS_COUNT` with the
   same comment style.
5. New unit coverage in `step.test.ts` asserts: threshold boundary
   behavior (task exactly at the threshold, task one day over), the
   cap-at-five-with-tail behavior, owner-blocker labeling, and the
   aggregate-suppression rule.
6. `pnpm typecheck` and the relevant module test suite stay green.
