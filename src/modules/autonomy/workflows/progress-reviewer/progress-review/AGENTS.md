# Progress Review Helpers

This directory holds the progress-reviewer's implementation helpers.

- Keep `../progress-review.ts` as the public export surface.
- Evidence collectors should stay grouped by source: runs, tasks, events,
  artifacts, git, and operator queues.
- Canonical owner-decision evidence uses the scoped core repository. Evidence
  projections observe decisions and never authorize owner actions.
- Action writer helpers belong in `action-writers.ts`; `actions.ts` should
  orchestrate applying reviewed actions without mixing in evidence collection.
