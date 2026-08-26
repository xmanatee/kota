# Backlog Promoter

Keeps `ready/` as a short, intentional execution queue.

- Trigger on `autonomy.queue.needs-promotion` when no actionable work exists and
  a dependency-clear, non-anchor backlog task can legally enter `ready`.
- This code-only workflow declares repository write access and task validation.
  Shared runtime owns its sandbox, capacity, recovery, commit, and publication.
- Rank candidates deterministically by authored priority, then age and id.
  Filter dependencies, anchors, and invalid lifecycle transitions before
  ranking; task class and prose do not reorder execution.
- Promote no more than the bounded small batch. Write
  `promotion-rationale.json` with considered, selected, and rejected candidates
  plus a human-readable summary.
- The commit message echoes the rationale summary so Git history remains useful;
  the deeper explanation stays in the run artifact.
- Tests cover selection, filtering, batch bounds, rationale, and task outcomes.
  Shared runtime tests own isolation and integration behavior.
