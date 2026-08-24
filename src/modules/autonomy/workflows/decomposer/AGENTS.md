# Decomposer Workflow

This directory contains the decomposer workflow definition and its prompt.

- Triggers on builder failure events and classifies structured timeout or
  exhausted repair outcomes.
- Resolves failed sources only through the canonical `.kota/runs/<run-id>`
  directory and authenticates run metadata plus `task-claim.json` against the
  exact builder-owned `pending-decomposition` claim. The artifact and active
  claim agree exactly; the current no-follow task must retain the claim-bound
  task-contract digest. A normal `ready/` → `doing/` move may replace the inode,
  but any other path or content change fails closed. Recheck before mutation.
  Missing or stale ownership, linked parents, and linked tasks fail closed.
- Both reasoning steps run passively under the agent's deny-all write scope.
  Native harnesses therefore use their read-only OS sandbox; hosted harnesses
  receive the passive read-tool policy.
- `review-decomposition` independently compares the plan with that exact task
  markdown. The task snapshot and planner output use separate screened,
  escaped untrusted exposed-output blocks; a rejection fails before any task
  mutation.
- `apply-decomposition` is the only mutation path: it creates planned ready
  tasks or reuses reviewer-confirmed open equivalents, carries the parent's
  hard dependencies into every replacement slice, records intra-plan
  dependencies, annotates the original, and moves it to `dropped/` through the
  task state machine. Reused `doing/` work is never rewritten.
- After the task-state commit, decomposer supersedes only the same failed
  builder run's `pending-decomposition` claim. This is the canonical success
  path that reopens dispatch after a clean timeout or exhausted repair.
- `checkDecompositionApplied` verifies the dropped original and every active
  subtask named by its `## Decomposed` section. Newly created tasks and reused
  tasks whose dependency/provenance record changed belong to the current
  mutation set before the workflow commits.
- The terminal commit uses an exact path set derived from the claimed source
  task, its dropped destination, and only the created or updated approved
  subtask paths.
- A terminal or missing claimed task is newer canonical evidence than the
  failed builder run, so the workflow skips it instead of creating stale work.
- Keep decomposition logic inside this module, not in core or in the builder itself.
