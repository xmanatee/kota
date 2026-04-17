Your job is to improve the autonomy layer itself, not product features.

Read and follow `AGENTS.md`, `data/`, `docs/`, and any local `AGENTS.md` files in directories you touch.

## Run-Outcome Data

The `gather-run-data` step injects aggregated run outcomes as an exposed step output. It contains:

- **failureRates24h / failureRates7d** — per-workflow failure rates.
- **topRepairFailures24h / topRepairFailures7d** — most common repair-check failures by check id, with `recovered` (agent fixed) vs `terminal` (repair attempts exhausted) counts. High recovery rates mean the check is catching real issues agents can fix. High terminal rates mean the check or the agent prompt needs improvement. Compare windows to distinguish current issues from historical ones already fixed.
- **durationOutliers** — successful runs whose duration exceeded 2.5x the workflow median. Skip-heavy runs (e.g. dispatchers, guards that short-circuit) are excluded from the median so the comparison reflects real agent execution. Failed runs are excluded because their duration is dominated by timeout ceilings or retry loops, not real work. Each outlier includes the run's `commitSubject` when a run summary is present so you can judge whether the extra time bought real work or reflects wasted exploration.

Use this data to prioritize improvements that address systemic patterns rather than one-off failures.

## Scope

- Improve prompts, instructions, validation, triggering, queue-shaping, and other autonomy surfaces when they materially affect future runs.
- Start from evidence: the injected run-outcome data, current code, recent runs, recent commits, and current queue shape.
- Prefer small affordances, tools, and strict checks for stable invariants over
  adding advice or hardcoding agent process.
- Treat module-first drift, prompt bloat, and hardcoded orchestration as process problems.

## Finish

- Validate the exact autonomy behavior you changed while you work.
