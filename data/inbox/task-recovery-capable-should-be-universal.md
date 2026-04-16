# Only improver and attention-digest survive daemon crash — everything else pauses dispatch

Today if the daemon crashes mid-run, only workflows with `recoveryCapable: true` get re-queued via `runtime.recovered`. That's only improver and attention-digest. Anything else (builder, decomposer, explorer, inbox-sorter, pr-reviewer) that was interrupted leaves dirty state → runtime pauses dispatch entirely and waits for human intervention.

Builder is the hard case: it holds a git worktree + branch-per-task mid-run, possibly with an open PR. Re-entering that state blindly is unsafe. Improver gets away with it because it has an explicit `clean-recovery-state` step that stashes dirty changes first.

Investigate:
- Should `recoveryCapable: true` be the default for every workflow, with each one responsible for a `clean-recovery-state` step (or equivalent reset-to-base) as a prerequisite?
- For builder specifically: what does safe recovery look like? Options — (a) abort the in-flight task, unwind the worktree/branch, re-queue the task; (b) resume from last committed step; (c) leave the worktree and fail the run cleanly. Which is least-surprising?
- Are there workflows that genuinely *cannot* be made recovery-safe, or is the current narrow set just laziness?
- What's the current "pause dispatch on interrupted non-recoverable run" behavior actually protecting against? Is that protection still useful if every workflow is recovery-capable?
- Draft the contract a workflow has to meet to declare `recoveryCapable: true` (e.g. first step is idempotent reset, no network side effects before the reset, etc.).
