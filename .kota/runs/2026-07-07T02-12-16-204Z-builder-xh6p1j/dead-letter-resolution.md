# Dead-Letter Resolution Attempt

## Cited Item

- Dead-letter: `dlq-9362cac4-7574-4718-bbf4-31ff4d2f65ef`
- Canonical store: `/Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json`
- Failed run: `2026-07-06T20-49-21-197Z-builder-tvwxsg`
- Superseding run cited by progress-review: `2026-07-07T00-47-50-272Z-builder-rwmd89`

## Evidence

- `canonical-dead-letter-open-item.json` preserves the canonical item. It is still `status: "open"` and has no redrive attempts.
- `failed-run-summary.json` shows the failed builder run claimed `task-add-loop-quality-audits-for-autonomous-workflows` and failed at the `build` step.
- The failed run's `error.txt` reports: `Repair agent for step "build" failed: Reconnecting... 2/5 (stream disconnected before completion: idle timeout waiting for websocket)`.
- The failed run's `critic-review.json` failed the first attempt because the loop-quality implementation was missing required source-processing evidence.
- `superseding-run-summary.json` shows the later builder run claimed the same task, completed successfully, committed, merged, released the claim, and emitted build completion.
- `/Users/xmanatee/Desktop/mono/apps/kota/data/tasks/done/task-add-loop-quality-audits-for-autonomous-workflows.md` is now `status: done`.
- The progress-review claim `local-loop-quality-audit-landed` cites `run:2026-07-07T00-47-50-272Z-builder-rwmd89`, `task:task-add-loop-quality-audits-for-autonomous-workflows`, and `git:commit:545ecf84ab5c`.

## Decision

Redrive is not appropriate. It would replay a failed builder run for work that a later builder run completed and merged. The correct resolution is dismissal as stale/superseded.

Dismissal reason to use:

```text
Dismissed as stale/superseded builder DLQ follow-up: failed run 2026-07-06T20-49-21-197Z-builder-tvwxsg claimed task-add-loop-quality-audits-for-autonomous-workflows and failed during repair-agent websocket idle timeout after critic review, while later builder run 2026-07-07T00-47-50-272Z-builder-rwmd89 completed the same task successfully, committed 545ecf84ab5c, recorded loop-quality audit and validation evidence, and moved the task to done. Redrive would duplicate completed work.
```

## Mutation Attempts

1. Daemon-control HTTP dismissal path:
   - Target: `http://127.0.0.1:49731/workflow/dead-letter/dlq-9362cac4-7574-4718-bbf4-31ff4d2f65ef?projectId=8nrg1m`
   - Result: blocked before request completion with `connect EPERM 127.0.0.1:49731`.

2. Source-mode CLI from the canonical checkout:
   - Command: `NODE_OPTIONS=--conditions=source node --import tsx src/cli.ts workflow dlq dismiss dlq-9362cac4-7574-4718-bbf4-31ff4d2f65ef --reason <reason>`
   - Result: KOTA reached the canonical store but failed writing `/Users/xmanatee/Desktop/mono/apps/kota/.kota/dead-letter-queue/items.json.tmp` with `EPERM`.

The worktree can prove the item is stale and record the exact dismissal rationale, but it cannot mutate the canonical runtime store from this sandbox.

## Operator-Capture Requirement

Run the dismissal command from an environment that can write the canonical checkout's `.kota/dead-letter-queue/items.json`, then capture the after state at:

`.kota/runs/2026-07-07T02-12-16-204Z-builder-xh6p1j/operator-dead-letter-after-dismissal.json`

The captured JSON should show `dlq-9362cac4-7574-4718-bbf4-31ff4d2f65ef` with `status: "dismissed"` and the dismissal reason above.
