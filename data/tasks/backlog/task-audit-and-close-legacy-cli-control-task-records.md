---
id: task-audit-and-close-legacy-cli-control-task-records
title: Audit and close legacy CLI control task records
status: backlog
priority: p2
area: repo-tasks
summary: After the operator-control fixes land, audit the old completed CLI/control tasks and current docs/help so no stale or overclaimed task record remains as the source of truth.
depends_on: [task-replace-readline-navigator-with-a-real-daemon-back, task-make-foreground-daemon-mode-expose-operator-contro, task-reconcile-dirty-recovery-pause-state-across-status, task-add-completion-evidence-gates-for-operator-client-]
created_at: 2026-07-06T15:16:45.700Z
updated_at: 2026-07-06T15:16:45.700Z
task_class: Meta
---

## Problem

Several historical task records and docs now say the CLI/operator control
experience is complete, while the current product still has legacy behavior:
the foreground daemon dashboard is passive, the full CLI client is still a
readline navigator, and stale recovery status can persist offline.

If the implementation tasks land without auditing the old records and help
text, the queue will still contain contradictory sources of truth about what
was completed.

## Desired Outcome

After the direct repair tasks are done, audit task records, local AGENTS/docs,
CLI help output, and operator-facing command names for stale or contradictory
claims. Preserve historical evidence, but make the current truth clear.

The old completed CLI/control tasks should either be genuinely satisfied by
the new implementation and evidence, or explicitly point to the superseding
tasks/commits that closed the remaining gap. No open/done/dropped task should
claim a separate legacy mechanism is the current operator-control path.

## Constraints

- Do not create a parallel changelog or audit surface. The current truth lives
  in task files, scoped AGENTS/docs, help output, and code.
- Do not rewrite history to pretend old work was correct. Add minimal
  supersession/current-truth notes only where needed.
- Keep docs concise and local. Prefer code/help clarity over prose if a claim
  can be made obvious in the command surface.
- This task must remain blocked by `depends_on` until the implementation and
  evidence-gate tasks are done.

## Done When

- `rg` over `data/tasks`, `docs`, `src/modules/cli`, and
  `src/modules/daemon-ops` finds no stale claim that the old readline
  navigator or passive daemon dashboard is the completed full operator client.
- The completed full-CLI task record is reconciled with the new evidence or
  explicitly superseded by the new task ids.
- CLI help and local AGENTS/docs consistently distinguish daemon host mode,
  shared UI client mode, workflow control commands, and status/inbox commands.
- Queue validation passes after the reconciliation.

## Source / Intent

Owner request on 2026-07-07: "Really understand all the tasks that weren't
properly completed or any legacy stuff and make sure it will be closed once
these newly created tasks are addressed." This task is the closure check for
the new operator-control repair slice.

## Initiative

Operator control plane closure and queue truthfulness.

## Product / Safety Link

Closes the Product gap where operators cannot reliably discover or trust
daemon/CLI controls, and prevents future autonomous work from treating stale
completed records as current truth.

## Acceptance Evidence

- Transcript under `.kota/runs/<run-id>/transcript.txt` showing the `rg`
  audit commands and the relevant clean results or reconciled hits.
- Transcript of `pnpm kota validate-tasks` or source-mode equivalent passing.
- Links in the task closeout to the implementation evidence for the four
  dependency tasks.
