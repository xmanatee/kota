# Superseded security-review DLQ disposition

## Decision

Dismiss `dlq-5b14f336-2999-4620-bb05-2042fd582e93`; do not redrive it.

The failed run `2026-07-28T04-24-35-747Z-security-review-sq3k48` reviewed
`7e4d800b74fb9340d40de3134b7f9fc1694ad9d7..cabc2c59a89ec80ecd1dfdc0af4e6dda70e575f9`
and stopped in `investigate-candidates` after the harness rejected the defensive
security content. The later run
`2026-07-28T04-53-22-834Z-security-review-sixhkj` completed successfully over
the broader
`7e4d800b74fb9340d40de3134b7f9fc1694ad9d7..bb7a7c348cc99d0c8a40f9bfcd4b91382694e966`
range. Git confirms the failed head is an ancestor of the later head. The later
run confirmed `finding-builder-unbounded-run-evidence-commit`, created canonical
Safety task `task-security-review-the-builder-recursively-force-stag`, and that
task is now done with focused regression evidence. Redrive would duplicate stale
review context.

## Canonical mutation status

`dead-letter-before-dismissal.json` records the canonical item as open. The
supported dismissal command could not reach the host daemon from the managed
sandbox, then its local-client fallback failed before replacement because the
canonical runtime store is outside the writable workspace. A fresh canonical
read in `dead-letter-after-failed-attempt.json` proves the item remains open and
unchanged; `canonical-mutation-attempts.txt` records the failure boundary.

Run this from the canonical host checkout or another environment that reaches
the authenticated daemon control API:

```text
env -u NODE_OPTIONS pnpm kota workflow dlq dismiss dlq-5b14f336-2999-4620-bb05-2042fd582e93 --reason "Superseded by successful security-review run 2026-07-28T04-53-22-834Z-security-review-sixhkj, whose broader 7e4d800b74fb9340d40de3134b7f9fc1694ad9d7..bb7a7c348cc99d0c8a40f9bfcd4b91382694e966 comparison contains the failed run's range, confirmed finding-builder-unbounded-run-evidence-commit, and created canonical Safety task task-security-review-the-builder-recursively-force-stag; redrive would duplicate stale review context."
```

Then capture `workflow dlq show` after-state and verify this filtered command no
longer reports the item:

```text
env -u NODE_OPTIONS pnpm kota workflow dlq list --status open --workflow security-review --json
```
