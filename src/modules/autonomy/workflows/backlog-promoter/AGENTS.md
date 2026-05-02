# backlog-promoter

This workflow keeps `ready/` honest as the short execution queue. When the
dispatcher reports actionable=0 with backlog>0 (`autonomy.queue.needs-promotion`)
this workflow deterministically promotes a small batch of the best backlog
candidates so builder runs land on intentionally selected work, not on whatever
backlog ordering happens to produce.

Runtime contract:

- Code-only workflow. No agent step, no per-step autonomy mode.
- Recovery-capable: stashes any tracked dirt before doing anything else.
- Never acts on a dirty worktree and never promotes more than
  `PROMOTION_BATCH_LIMIT` tasks per run.
- Ranking is deterministic in `promotion.ts`: priority (p0..p3), then
  strategic-area tie-break (architecture/autonomy/core/modules), then oldest
  `updated_at`, then id. The same record set therefore picks the same batch
  every run.
- Every successful run writes `promotion-rationale.json` to its run directory:
  candidates considered (backlog + blocked, so blocked alternatives are
  visible), selected with per-pick reason, rejected (lower-ranked backlog and
  stuck blocked work), and a human-readable `summary`.
- The commit message echoes the rationale summary so the operator-facing
  `git log` is enough to audit the loop's queue-shaping decisions; deeper
  detail stays in the run-directory artifact.
