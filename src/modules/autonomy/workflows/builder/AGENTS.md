# Builder Workflow
- Own one normalized task at a time. Resume `doing/` before pulling from `ready/`; `backlog-promoter` alone promotes backlog and records why.
- Own implementation quality, architecture, completeness, honest task-state updates, and hard validation fixes before the run ends.
- Tasks define the contract and constraints; the implementing agent owns the detailed plan.
- Changes here shape the default autonomous development behavior.
- Mutating work uses the workflow-selected cwd: normally a task worktree; `branchPerTask: false` is an explicit serial opt-out.
- Give preserved work one automatic continuation. Productive builder work is
  governed by trusted progress; a continuation that fails or stops reporting
  progress preserves the worktree for typed state-recovery review.
- Recovery scanning decides whether to emit an automatic continuation. Once a
  recovery event is queued, its exact task/worktree target governs consumption;
  do not reapply the producer's automatic-attempt gate in the builder.
- Prefer validation rails over hardcoded pre-agent task moves or scope policing.
- A clean timeout or exhausted repair reserves the task claim for decomposer
  disposition. Builder must not reclaim that task while decomposition is
  pending; ordinary failures still release clean claims normally.
- Long-running harness readiness runs before task claim acquisition; unverifiable unattended renewal leaves the task and worktree untouched.
- Source-changing commits request daemon restart before emitting the build-committed handoff. The paused runtime persists that handoff so consumers evaluate it only after loading the committed definitions; task-only commits keep the immediate path.
## Success Criteria
Declare concrete success criteria before implementation and verify them before completion:

- `$KOTA_RUN_DIR/success-criteria.txt`
- `$KOTA_RUN_DIR/success-criteria-verified.txt`

`$KOTA_RUN_DIR` is agent-writable `.kota/builder-evidence/`, not the canonical workflow store; the protocol files above are code-registered.
Preserved-work continuations keep the original evidence and projection lineage; execution-scoped temp, port, and run metadata use the new run.
Put additional evidence under `$KOTA_RUN_ARTIFACT_DIR`; register its path and kind
in `$KOTA_RUN_DIR/evidence-manifest.json`. Before task validation, the repair loop
screens, bounds, projects to `.kota/runs/<run-id>/evidence/`, and exact-stages it.
The terminal commit repeats projection and excludes both runtime namespaces.
Unregistered files cannot satisfy Product evidence. Text passes secret screening;
PNG is re-encoded without metadata; other opaque containers are not registrable.
Calibration-repair tasks register `calibration-repair.json`. Gate-retune evidence
cites the claimed task's Git-backed monitor snapshot, preserves its aggregate,
matches active config, cites repeated monitor history, and assigns every retained
weak-evidence signal to an open source-bound disposition task; unrelated,
aggregate-only, undispositioned, or prompt-reset evidence fails.

Number each criterion at column 0 (`1.`, `2.`, ...), one per Done-When item.
The repair check counts numbered items only; column-0 bullets (`- `/`* `) and
prose are treated as notes, so `Design notes` or `Known limitations` sections
do not inflate the criterion count. Match the numbered-item count between the
two files.

Keep completion reviewable. When external resources or runtime behavior matter,
leave enough ordinary context for later verification. If a required resource
cannot be reached, record the blocker instead of inferring completion.
## Runtime Probes

The critic inspects the diff, task state, and run artifacts. When success
lives in runtime behavior a diff cannot prove (HTTP route payload, UI
regression, event ordering, daemon runtime misbehavior), a task can declare
an optional runtime probe the critic runs before judging.

- A probe is a typed shell command with a deterministic exit-code predicate:
  exit 0 passes, any other status fails. The probe is the task author's
  declared success predicate for behavior the diff alone cannot prove.
- Default to artifact-only success. Reshape the task to land a test
  assertion, a structured output artifact, or a repo-state change before
  reaching for a probe. Probes should be the exception, added only when
  success genuinely lives outside repo state and no honest artifact-only
  reshaping exists.
- A probe is declared inside the task body as a `## Runtime Probe` section.
  The section body is `key: value` lines, optionally wrapped in a fenced
  code block. Recognized keys: `command` (required) and `timeoutMs`
  (optional, defaults to 120000). The command must be one constrained
  package-script invocation (`pnpm run <script>` or `pnpm test`, capped at 30
  minutes) or one provenance-pinned live fixture
  (`pnpm kota eval run --fixture <id> --repeats 1 --keep`, capped at four
  hours), not a shell pipeline. Malformed declarations fail loudly — the
  critic does not silently skip a broken probe.
- A builder run may not add or mutate the probe it is about to execute. The
  critic only runs a probe whose parsed command and timeout match the task
  file's declaration in `git HEAD`; otherwise it records a rejected
  `runtime-probe.json` and fails before execution.
- Probes run only after a live, fail-closed check; Git-HEAD authenticates the
  predicate, not execution. Linux requires Bubblewrap mount/network/IPC/PID
  namespaces and teardown plus a non-piped `core_pattern` and hard-zero core
  limit; pipe-handler and non-Linux hosts record `not-executed`. A tmpfs overlay
  holds writes; outside-name inodes freeze and pathname IPC/device inodes reject.
- The probe's `runtime-probe.json` is projected from the builder evidence source
  into typed run evidence, committed, and threaded into the critic's prompt as critical
  unless the probe itself is miscalibrated.
- The critic still exercises calibrated judgment. It can accept a failed
  probe when the failure is environmental (network outage, missing binary)
  and unrelated to the staged change, but must justify that in the verdict
  `summary`.
## Source Size Exceptions

The builder blocks severe source-size warning batches before commit; a cleanup task can declare a typed exception only when every named warning shrinks:

```md
## Source Size Exception

kind: source-size-cleanup
files:
- src/path/to/file.ts
```

This section does not waive positive growth, unnamed warning files, or unrelated oversized edits; it only keeps a reducing cleanup task from blocking.
