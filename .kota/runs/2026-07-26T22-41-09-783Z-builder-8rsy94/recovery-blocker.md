# Recovery blocker

The canonical `workflow state-recovery` inspection succeeded, but this linked
builder sandbox cannot mutate the sibling stale worktree or its Git metadata,
and authenticated daemon control is unavailable from the sandbox.

The supported supersede attempt stopped at `git worktree remove --force` with
`Operation not permitted`. Because cleanup happens before claim mutation, the
claim and dead letter remain unchanged. The stale dirty delta is preserved
losslessly in `preserved-stale-worktree.patch` (SHA-256
`941147cf27a8d365b57c9ac25f75d614298e4cb02767758dd4ef829f31221fd1`),
including the formerly untracked prototype fixture.

A trusted host should run the canonical supersede-and-cleanup action from the
canonical checkout, citing builder run
`2026-07-26T22-41-09-783Z-builder-8rsy94`, dismiss
`dlq-4485507f-d964-48df-9c7a-ff7642eb1f23` as an obsolete classifier-refusal
dispatch, and capture the resulting claim, worktree, dead-letter, and task
projection in `trusted-host-recovery-complete.json`. The underlying canary
task must remain in `ready/` so it becomes claimable; its incomplete stale
delta is preserved evidence, not a completed implementation.
