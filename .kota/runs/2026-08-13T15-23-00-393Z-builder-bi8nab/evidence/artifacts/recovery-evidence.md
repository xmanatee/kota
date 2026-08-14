# Preserved builder work recovery

The preserved diff contains the task's canonical `ready` to `done` transition.
No implementation diff is missing: repair commit
`132438782a063cabc88a8f04445f0c574035cf85` is an ancestor of this worktree's
HEAD and predates the escalator commit that created this task. It identifies
the same three source builder runs and fixes their shared local failure by
consulting the resolved harness capability before passing `resumeSessionId`.

Committed live evidence from builder run
`2026-08-13T13-41-33-035Z-builder-agejs2` proves a post-fix Codex repair
iteration reached the agent and completed without the prior option rejection.
The related resume-failure dead letters remain retained for operator-side
disposition because the canonical root-scope store is outside this worktree's
native-agent boundary; their failed source-run selectors are preserved in that
run's `repair-delivery-and-dlq-reconciliation.md` artifact.

This recovery reran the focused repair-loop, detector, and operator-attention
tests successfully. The task can remain `done` without weakening the detector,
changing its threshold, or broadening infrastructure exclusions.
