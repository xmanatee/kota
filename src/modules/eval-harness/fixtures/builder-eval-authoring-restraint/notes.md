# builder-eval-authoring-restraint

## Source

No source run id. This is a smoke fixture prompted by AgentEvalBench's
reported eval-authoring failure shape: coding assistants often produce
over-broad, non-executing agent evaluations when the task lacks local,
domain-specific evaluation requirements.

## Why no real-run source

KOTA has no matching failed builder run for this exact meta-work shape. The
fixture is synthetic and intentionally narrow: a deterministic refund-agent
trace runner, two good cases, two bad cases, one verifier script that requires
executable JSON evidence, and a replay recording so the builder branch runs
deterministically without network access.

## Why this fixture captures it

The task asks the builder to add only `scripts/evaluate-traces.mjs` plus its
result artifact. `scripts/check-evaluation.mjs` runs that evaluator, validates
the result contract, proves the good cases pass, proves the bad cases are
caught, and rejects unrelated metric sprawl. The final changed-path predicate
keeps the builder from fixing the runner or cases instead of authoring the
evaluation.
