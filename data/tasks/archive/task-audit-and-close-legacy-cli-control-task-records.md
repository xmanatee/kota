---
status: done
---

# Audit and close legacy CLI control task records

## Problem

Several historical task records and docs said the CLI/operator control
experience was complete while, before the repair slice, the product still had
legacy behavior: the foreground daemon dashboard was passive, the full CLI
client was still a readline navigator, and stale recovery status could persist
offline.

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

## Completion Notes

Audit transcript for this closure:
`.kota/runs/2026-07-07T16-43-44-419Z-builder-0eq4yw/transcript.txt`.
Source-mode task validation:
`.kota/runs/2026-07-07T16-43-44-419Z-builder-0eq4yw/validation.txt`.

Dependency evidence:

- `task-replace-readline-navigator-with-a-real-daemon-back`:
  `.kota/runs/2026-07-06T18-08-37-897Z-builder-n8qu44/transcript.txt`.
- `task-make-foreground-daemon-mode-expose-operator-contro`:
  `.kota/runs/2026-07-06T15-29-18-210Z-builder-v70rd2/transcript.txt`.
- `task-reconcile-dirty-recovery-pause-state-across-status`:
  `.kota/runs/2026-07-06T20-49-21-196Z-builder-rej04x/transcript.txt`.
- `task-add-completion-evidence-gates-for-operator-client-`:
  `.kota/runs/2026-07-07T15-50-32-148Z-builder-smt7x7/validation-transcript.txt`.

Current truth after reconciliation: bare `kota` and `kota navigate` are the
shared UI CLI client entry points; `kota daemon` is the foreground host and
dashboard with control-path hints; workflow control remains under
`kota workflow`; status/inbox have dedicated snapshot commands.
