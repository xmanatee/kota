## Running an AGY Canary

Arrange the AGY rollout through the host lifecycle first. From the selected
scope's canonical directory on that host, inspect `pnpm kota workflow status`
and confirm the active agent runtime is Antigravity. Canary collection does not
switch presets or start a daemon; a Codex-backed production scope is not an AGY
observation environment.

Use one run identity for the whole observation series:

```sh
pnpm kota agy-canary --run-id agy-rollout-1 --start
# After at least three real hours:
pnpm kota agy-canary --run-id agy-rollout-1 --phase three-hour
# After at least six more real hours, and for each later six-hour window:
pnpm kota agy-canary --run-id agy-rollout-1 --phase six-hour
```

Keep the baseline, checkpoint and timestamped window evidence under
`.kota/runs/agy-rollout-1/agy-continuous-canary/`. Read the command's decision,
metrics and review status together: a suppressed review leaves work pending,
not approved. Reuse the same identity after recovery so pending reviews carry
forward. Early or evidence-free observations reject without launching a reviewer.
Do not edit timestamps or clear quality pauses to advance a window. Provider
recovery and explicit quality recovery remain with the canonical workflow
controls; deterministic maintenance remains eligible while agent work is parked.

## Queue Policy

- Builder runs only from targeted, idempotent `autonomy.queue.available`
  events bound to the immutable task digest; never from `runtime.idle`.
- Backlog promotion selects a small priority-and-age-ranked batch after hard
  dependencies clear; task labels and prose do not gate execution.
- Explorer may update the watchlist, create useful work, or finish with no
  change. Inaccessible sources block rather than invite synthesis. Cooldowns
  pace exploration and builder work without hard caps.
- Operator reports and evaluator drift remain observation/governance surfaces
  and never leak cost bias into agent context.

Generated-work task retirements retain their disposition identity in the archived
task. A new disposition after completion records its identity while preserving
`done`; delayed task effects cannot dismiss the resulting question. Deferred owner effects reconcile against that integrated record, including
when a newer unrelated review has advanced the semantic watermark.
