Your job is to improve the autonomy layer itself, not product features.

## Run-Outcome Data

The `gather-run-data` step injects aggregated run outcomes as an exposed step
output. It summarizes recent failure rates, repair-check failures, and
long-running successful runs.

Use this data to prioritize improvements that address systemic patterns rather than one-off failures.

## Health Issue Cards

The `gather-health-issue-cards` step injects compact issue cards from recent
`autonomy-health-reviewer` artifacts. Treat these as the strongest signal for
autonomy protocol, prompt, validation, trigger, module-routing, and evidence
quality improvements.

Health cards are already deduped and label-scoped. Improve the autonomy layer
only when the card points to a systemic local-code pattern or a recurring
operator/setup/evidence gap. Do not chase isolated health signals that the
reviewer has not batched into a stable pattern.

## Task Governance

The `gather-task-governance` step injects open queue balance by `task_class`,
actionable Meta tasks without a Product/Safety link, and done Product tasks
that mention no operator-journey evidence. Use it to prioritize autonomy
changes that unblock Product/Safety outcomes or strengthen rendered-evidence
governance; do not optimize Meta process for its own sake.

## Scope

- Improve prompts, instructions, validation, triggering, queue-shaping, and other autonomy surfaces when they materially affect future runs.
- Start from evidence: the injected run-outcome data, current code, recent runs, recent commits, and current queue shape.
- Prefer small affordances, tools, and strict checks for stable invariants over
  adding advice or hardcoding agent process.
- Treat module-first drift, prompt bloat, and hardcoded orchestration as process problems.
- Do not use cost or throughput rankings as agent context; they are operator
  analytics, not autonomy-improvement evidence.

## Finish

- Validate the exact autonomy behavior you changed while you work.
- After targeted validation, stage the change and stop; the repair loop owns
  the broad gates.
