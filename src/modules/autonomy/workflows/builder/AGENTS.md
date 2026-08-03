# Builder Workflow

- Own one cohesive normalized task at a time. Resume active `doing/` work before
  pulling one task from the short `ready/` queue. Never promote `backlog/` tasks
  here; `backlog-promoter` records the rationale. Task semantics live under `data/tasks/`.
- Own implementation quality, architecture, completeness, honest task-state updates, and hard validation fixes before the run ends.
- Tasks define the contract and constraints; the implementing agent owns the detailed plan.
- Changes here shape the default autonomous development behavior.
- Mutating builder work runs in the workflow-selected workspace. By default
  that workspace is a prepared task worktree; `modules.builder.branchPerTask:
  false` is an explicit serial opt-out. Agents and sub-agents must use the
  provided cwd instead of assuming the canonical checkout.
- Give preserved work one automatic continuation. Productive builder work is
  governed by trusted progress; a continuation that fails or stops reporting
  progress preserves the worktree for typed state-recovery review.
- Prefer validation rails over hardcoded pre-agent task moves or scope policing.

## Success Criteria

The builder must declare concrete success criteria before implementation and verify them before completion:

- `$KOTA_RUN_DIR/success-criteria.txt`
- `$KOTA_RUN_DIR/success-criteria-verified.txt`

`$KOTA_RUN_DIR` is the agent-writable `.kota/builder-evidence/` source, never the
canonical workflow run store; the protocol files above are code-registered.
Preserved-work continuations retain the original evidence directory and durable
projection lineage while execution-scoped temp, port, and run metadata use the
new continuation run.
Put additional evidence under `$KOTA_RUN_ARTIFACT_DIR`; register its path and kind
in `$KOTA_RUN_DIR/evidence-manifest.json`. Before task validation, the repair loop
screens, bounds, projects to `.kota/runs/<run-id>/evidence/`, and exact-stages it.
The terminal commit repeats projection and excludes both runtime namespaces even
without `.kota` ignore rules. Unregistered files stay runtime-only and cannot
satisfy Product evidence. Text must pass secret screening; PNG is re-encoded
without metadata, and other opaque containers are not registrable.

Number each criterion at column 0 (`1.`, `2.`, ...), one per Done-When item.
The repair check counts numbered items only; column-0 bullets (`- `/`* `) and
prose are treated as notes, so `Design notes` or `Known limitations` sections
do not inflate the criterion count. Match the numbered-item count between the
two files.

Keep completion reviewable. If external resources or runtime behavior matter,
leave enough ordinary context in the task state, docs, code, or run notes for a
later reviewer to verify the result. If a required resource cannot be reached,
record the blocker instead of inferring completion.

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

The builder treats severe source-size warning batches as blocking before commit.
A cleanup task can declare a typed exception only when every named warning shrinks:

```md
## Source Size Exception

kind: source-size-cleanup
files:
- src/path/to/file.ts
```

This section does not waive positive growth, unnamed warning files, or unrelated oversized edits; it only keeps a reducing cleanup task from blocking.
