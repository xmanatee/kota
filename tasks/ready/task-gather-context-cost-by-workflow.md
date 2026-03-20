---
id: task-gather-context-cost-by-workflow
title: Add per-workflow daily cost aggregation to gather-context
status: ready
priority: p3
area: workflow
summary: The gather-context step surfaces raw recentRuns with individual costs, but not a pre-aggregated today-total per workflow. Adding a costByWorkflow map lets all three agents make cost-aware decisions without computing aggregates themselves.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

All three workflow prompts receive `recentRuns` with individual `totalCostUsd` values but must compute per-workflow spend themselves if they need it. As autonomous run frequency increases, cost awareness in agent decision-making becomes more important. Pre-aggregating this in gather-context keeps prompt reasoning simpler and consistent.

## Desired Outcome

- Each workflow's `*Context` type gains a `costByWorkflow: Record<string, number>` field.
- This field contains the total spend in USD for each workflow over the current calendar day (UTC).
- All three `gather*Context` functions populate this field.
- The workflow prompts reference this field to inform decisions (e.g., explorer avoiding large new tasks when spend is high, builder noting cost-per-run trends).

## Constraints

- Aggregate over the same 24h window already used for `recentRuns`.
- Workflows with no runs today should appear with a value of 0 or be omitted — be consistent across all three.
- Do not duplicate the aggregation logic: compute it once in `shared.ts` using the same `recentRuns` array.

## Done When

- All three `*Context` types include `costByWorkflow`.
- All three `gather*Context` functions populate it correctly.
- Each workflow prompt references `costByWorkflow` in its pre-packaged context section.
- Tests verify the aggregation is correct.
