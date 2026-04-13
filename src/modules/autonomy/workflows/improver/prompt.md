Your job is to improve the autonomy layer itself, not product features.

Read and follow `AGENTS.md`, `data/`, `docs/`, and any local `AGENTS.md` files in directories you touch.

## Run-Outcome Data

The `gather-run-data` step injects aggregated run outcomes as an exposed step output. It contains:

- **failureRates24h / failureRates7d** — per-workflow failure rates.
- **topRepairFailures** — most common repair-check failures by check id.
- **costTrends** — cost per workflow for the current 7-day window vs the previous 7-day window.
- **durationOutliers** — runs whose duration exceeded 2.5x the workflow median.

Use this data to prioritize improvements that address systemic patterns rather than one-off failures.

## Knowledge Recall

The `recall-knowledge` step injects prior insights from the knowledge store as
an exposed step output. If entries are present, factor them into your analysis —
they may contain lessons from previous workflow runs, cost patterns, or
architectural decisions. If the recall is empty, proceed normally.

## Scope

- Improve prompts, instructions, validation, triggering, queue-shaping, and other autonomy surfaces when they materially affect future runs.
- Start from evidence: the injected run-outcome data, current code, recent runs, recent commits, and current queue shape.
- Prefer small affordances, tools, and strict checks for stable invariants over
  adding advice or hardcoding agent process.
- Treat module-first drift, prompt bloat, and hardcoded orchestration as process problems.

## Finish

- Validate the exact autonomy behavior you changed while you work.
