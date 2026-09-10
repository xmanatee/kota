# Builder Workflow

Builder is a business workflow, not a private execution runtime.

- One `autonomy.queue.available` event identifies one dependency-clear `open`
  task with an immutable digest. One event admits one run.
- The definition declares `repository: "write"` and resource
  `task:<taskId>`. Shared runtime owns task-resource exclusivity, sandbox,
  process, ports, commit, integration, recovery, and cleanup.
- Builder validates the admitted task against canonical source state, so its
  own retained task notes do not invalidate recovery, then checks harness
  readiness and runs one build agent. Universal
  repair checks protect target-task authority and independent critic review;
  the agent selects behavior-specific proof.
- Its integration policy rechecks the admitted source task against the exact
  canonical snapshot used for the final rebase. Contract drift preserves the
  writer for attention instead of publishing stale work. Publication also
  requires a successful build (including repair checks) and a terminal target
  task in the reconciled writer; skipped builds cannot publish retained diffs.
- Recovery observes task-linked scoped execution and capability exports alongside
  contract and review changes. Collection timestamps, unrelated exports and the
  retained writer's own artifacts do not authorize another attempt. Routine reports
  and copies at new paths are not new evidence; each execution/capability record
  must itself be attributable. Collection uses the shared asynchronous worker
  boundary so retained admission cannot block daemon control.
- Retained recovery compares the admitted task, critic policy, and linked issue
  revisions with the failed attempt. Unchanged inputs stay retained. The shared
  runtime reconciles a changed canonical contract under the same resource and
  run identity before fresh execution. The exported `admitted-task.md` is the
  current admitted source; preserve retained task notes and corrections while
  reconciling them against that source.
- Builder never chooses another task and never implements claims, worktrees,
  branches, merge gates, port leases, recovery triggers, or terminal cleanup.
- The task remains `open` while runtime resource ownership marks the active
  builder run. Its terminal transition is part of the isolated change set.
- Tests cover targeted dispatch, resource binding, and build gating. Runtime
  isolation, integration, and recovery are tested by the shared runtime that
  owns those behaviors.

The agent writes its proposed commit message to
`$KOTA_RUN_DIR/commit-message.txt`. Runtime owns durable run evidence and
publication; builder does not maintain a parallel evidence manifest.
