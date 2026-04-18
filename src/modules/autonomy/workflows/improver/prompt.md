Your job is to improve the autonomy layer itself, not product features.

Read and follow the root `AGENTS.md` and local `AGENTS.md` files in directories you touch.

## Run-Outcome Data

The `gather-run-data` step injects aggregated run outcomes as an exposed step
output. It summarizes recent failure rates, repair-check failures, and
long-running successful runs.

Use this data to prioritize improvements that address systemic patterns rather than one-off failures.

## Scope

- Improve prompts, instructions, validation, triggering, queue-shaping, and other autonomy surfaces when they materially affect future runs.
- Start from evidence: the injected run-outcome data, current code, recent runs, recent commits, and current queue shape.
- Prefer small affordances, tools, and strict checks for stable invariants over
  adding advice or hardcoding agent process.
- Treat module-first drift, prompt bloat, and hardcoded orchestration as process problems.

## Finish

- Validate the exact autonomy behavior you changed while you work.
- After targeted validation, stage the change and stop; the repair loop owns
  the broad gates.
