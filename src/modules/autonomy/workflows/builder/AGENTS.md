# Builder Workflow

Builder is a business workflow, not a private execution runtime.

- One `autonomy.queue.available` event identifies one dependency-clear
  `ready`/`doing` task with an immutable digest. One event admits one run.
- The definition declares `repository: "write"` and resource
  `task:<taskId>`. Shared runtime owns task-resource exclusivity, sandbox,
  process, ports, commit, integration, recovery, and cleanup.
- Builder validates that the targeted contract still matches its isolated
  workspace, checks harness readiness, then runs one build agent with the
  normal critic and repair checks.
- Its integration policy rechecks the admitted source task against the exact
  canonical snapshot used for the final rebase. Contract drift preserves the
  writer for attention instead of publishing stale work.
- Builder never chooses another task and never implements claims, worktrees,
  branches, merge gates, port leases, recovery triggers, or terminal cleanup.
- The task transition is part of the isolated change set. Runtime resource
  ownership remains held until integration succeeds or the run reaches an
  explicit terminal disposition.
- Tests cover targeted dispatch, resource binding, and build gating. Runtime
  isolation, integration, and recovery are tested by the shared runtime that
  owns those behaviors.

The agent writes its proposed commit message to
`$KOTA_RUN_DIR/commit-message.txt`. Runtime owns durable run evidence and
publication; builder does not maintain a parallel evidence manifest.
