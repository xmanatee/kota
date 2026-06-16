# Add a general runtime issue recovery loop

KOTA has partial self-recovery, but not a general mechanism that regularly reads
daemon/module logs, dead letters, interrupted runs, stuck shutdowns, and repeated
operator-visible runtime failures, then creates one bounded repair task or owner
ask with evidence.

Current mechanisms found:

- `runtime.recovered` marks stale active workflow runs interrupted and wakes
  recovery-capable workflows.
- `workflow-failure-escalator` opens repair tasks for repeated non-infrastructure
  workflow failure patterns from `.kota/runs` metadata.
- `trajectory-diagnostic-escalator` opens repair tasks for repeated typed
  trajectory diagnostics.
- `progress-reviewer` can cite runs, dead-letter counts/items, tasks, approvals,
  owner questions, artifacts, and git evidence.
- `attention-digest` surfaces failed/interrupted monitored runs.

Gap:

- Module/channel logs are not part of a deterministic recovery loop. For example
  `.kota/modules/telegram/logs.jsonl` recorded repeated Bot API `getUpdates`
  conflicts and network failures, but no automatic repair task was created from
  that log pattern.
- Open dead-letter items are visible, but repeated open DLQ patterns and stale
  DLQ items are not guaranteed to become one consolidated repair task.
- Interrupted runs and graceful-stop timeouts can surface in inbox, but are not
  consistently converted into root-cause repair work.
- The loop should avoid creating noisy meta churn. It should consolidate by root
  cause, cite exact evidence, and either create one repair task, ask the operator
  for a missing external action, or mark the pattern as already covered.

Desired outcome:

- Add a daemon/runtime health auditor workflow or extend an existing one so KOTA
  can periodically and on `runtime.recovered` inspect:
  `.kota/modules/*/logs.jsonl`, `.kota/dead-letter-queue/items.json`,
  recent failed/interrupted run metadata, daemon shutdown/stop evidence, and
  operator inbox runtime warnings.
- The auditor should classify local-code, external-service/auth, operator-action,
  duplicate-consumer, and cost-risk patterns.
- It should create at most one ready repair task per stable local-code pattern,
  one owner question/setup item per operator-action pattern, and one attention
  digest entry per unresolved high-risk pattern.
- Acceptance evidence must include fixtures for Telegram `getUpdates` conflict
  logs, stale open DLQ items, repeated interrupted runs, and a noisy external
  provider failure that must not create local repair churn.
