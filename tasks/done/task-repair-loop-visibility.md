---
id: task-repair-loop-visibility
title: Surface repair loop iterations in kota workflow show
status: done
priority: p3
area: workflow
summary: The post-check repair loop records iteration data (attempt count, failures, per-iteration cost) in run metadata, but kota workflow show does not render it. Operators cannot see how many repairs ran, what failed, or what they cost without reading raw JSON.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

`runAgentRepairLoop` stores `repairIterations` on the step output, including per-attempt failure details and cost. This data exists in `.kota/runs/<id>/metadata.json` but `kota workflow show` ignores it — the step just shows its final status with no indication that repair ran.

## Desired Outcome

- `kota workflow show <runId>` shows a repair summary under any step that ran the repair loop.
- Summary includes: number of repair attempts, which checks failed at each attempt, and total repair cost.
- Repair cost rolls up into the step's displayed cost.
- No change to default output for steps without repairs.

## Constraints

- Read from existing `repairIterations` field already stored in step output — no schema changes needed.
- Keep the display compact; do not dump full repair agent transcripts in the default view.
- Changes belong in `workflow-cli/run-show.ts` and `workflow/run-store-helpers.ts`.

## Done When

- Steps with repair iterations display a concise repair summary in `kota workflow show`.
- Repair cost is included in step cost display.
- Tests cover a step with repair iterations and a step without.
