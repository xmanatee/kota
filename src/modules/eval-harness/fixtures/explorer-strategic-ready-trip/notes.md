# explorer-strategic-ready-trip

## Source

- Run id: `2026-04-20T18-24-04-094Z-explorer-r2qqhx`
- Workflow: `explorer`
- Supporting evidence run: `2026-04-20T17-22-53-157Z-explorer-cabdbc`

The `inspect-queue` output on `r2qqhx` shows `ready=1` with every waiting
task at `p3`. The `explore` step's `repairIterations[0]` records the
`strategic-ready-coverage` check firing with severity `error`:

```
data/tasks/ready must keep at least one p0/p1/p2 task. The actionable
queue has drifted to p3-only work, which is too weak for the front of
the autonomous queue.
```

`cabdbc` ran into the same trip an hour earlier from a slightly different
starting state (`ready=0`, explorer added a p3 task first, then was forced
into a second agent iteration that added a p2). Both runs burned an extra
agent iteration (+20 min each, ~$1.35–$1.77 per repair) before the queue
satisfied `assertStrategicReadyCoverage`. `src/modules/autonomy/workflows/explorer/AGENTS.md`
records the recurring 15–25-minute repair-loop cost tied to this trip.

## What failed

The explorer fired on a thin queue and created additional work, but
neither the new work nor the existing ready task carried a strategic
priority (`p0`/`p1`/`p2`). The phase-1 `strategic-ready-coverage` check
rejected the run so the repair loop had to re-run the agent to promote
or add a strategic task.

## Why this fixture captures it

`initial/data/tasks/ready/task-trim-docs-convention-note.md` seeds the
working directory with exactly one p3 task — the same pre-run shape that
tripped `r2qqhx`. Backlog and inbox are empty, so the explorer's trigger
predicate (`inboxCount === 0 && waitingCount <= 2 && waitingCount > 0`)
fires and the run proceeds.

The fixture passes only when `data/tasks/ready/` contains at least one
task AND at least one ready task is priority `p0`/`p1`/`p2`. An explorer
that fails to promote the seed or add a strategic peer leaves the queue
matching the real repair-loop trip and fails the second predicate — the
same failure shape the repair check exists to catch, now observable at
the harness layer instead of requiring a live +20-minute agent re-run.

Either remediation the explorer exercises in production satisfies the
predicate: adding a new strategic task or promoting the seeded p3.
