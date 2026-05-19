---
id: task-add-workflow-trial-runs-in-isolated-temporary-proj
title: Add workflow trial runs in isolated temporary projects
status: done
priority: p2
area: modules
summary: Add a workflow trial mode that executes real workflow runs against an isolated temporary project copy and captures side effects as run artifacts, closing the gap between dry-run plans and production runs.
created_at: 2026-05-18T11:07:15.262Z
updated_at: 2026-05-19T16:05:18.886Z
---

## Problem

`kota workflow run --dry-run` validates a workflow plan without executing
agents, tools, bus emits, run-directory writes, or repo mutations. That is the
right preflight layer, but it leaves a gap for workflow authors and operators
who need to test the real side effects of a workflow before running it against
the live project queue, stores, channels, or GitHub-facing surfaces.

GitHub Agentic Workflows now documents TrialOps: temporary isolated repos that
execute workflows, capture safe outputs, support repeat runs and workflow
comparison, and summarize results without affecting the target codebase. KOTA
has the primitives to do this locally through projects, workflows, run
artifacts, and modules, but no single operator surface that executes a real
workflow against an isolated temporary project copy and reports the resulting
side effects as evidence.

## Desired Outcome

A `kota workflow trial <workflow>` path, with matching `KotaClient.workflow`
contract and daemon route if needed, runs a real workflow in an isolated
temporary project workspace and writes a complete trial report under the
normal run artifact tree. The trial executes the same workflow definition and
step runtime as production, but the default project root, task queue, stores,
and output side effects point at the temporary project copy unless a caller
explicitly opts into a live target.

The command should let operators provide a trigger payload, repeat count, and
optional comparison list of workflows or payload variants. Trial results should
name every created or changed artifact, bus event, queued workflow, task/store
mutation, and external-output attempt that occurred inside the isolated trial.
For dangerous tools or configured external transports, the trial must either
route through the existing approval/risk controls or fail loudly with an
explicit unsupported-live-side-effect result.

## Constraints

- Keep this in the existing workflow-ops / workflow-runtime model. Do not add
  a second workflow engine, a parallel run store, or a workflow-specific DSL.
- Runtime state and reports belong under `.kota/` and `.kota/runs/`; do not add
  a root-level `trials/` or sibling runtime directory.
- The default trial workspace must be disposable and isolated from the source
  project. If implementation uses a copied project tree, preserve repo-local
  `AGENTS.md`, `docs/`, `data/`, and module discovery behavior so agents see a
  realistic project shape.
- External writes stay explicit. GitHub comments, notification sends, channel
  posts, provider calls, and other live effects must be captured, approved, or
  blocked by existing tool risk and module boundaries rather than silently
  swapped for mocks.
- Do not weaken `workflow run --dry-run`; dry-run remains the no-execution plan
  check. Trial mode is the heavier real-execution evidence path.
- Multi-project daemon behavior must stay explicit: a trial run must record
  which project id or temporary project bundle it used and must not mutate the
  daemon's active/default project selection as a side effect.

## Done When

- `kota workflow trial <workflow> --payload <json>` runs the workflow against
  an isolated temporary project and exits with a clear pass/fail summary.
- Trial reports are written under `.kota/runs/<run-id>/workflow-trial/` and
  include trigger payload, workflow id, temporary project path or id, step
  statuses, changed files, task/store mutations, bus events, queued downstream
  workflows, and any blocked external side effects.
- The workflow client contract and daemon HTTP route expose trial execution
  without bypassing the existing `KotaClient` namespace pattern.
- `--repeat <n>` records per-attempt reports plus a combined summary suitable
  for spotting nondeterminism in agent or code-step behavior.
- A comparison mode can run the same payload against multiple workflows or
  payload variants and emit one combined JSON summary.
- Focused tests cover project isolation, changed-file capture, blocked external
  side effects, repeat summaries, and daemon-up / daemon-down CLI behavior.
- Existing dry-run tests still prove `kota workflow run --dry-run` creates no
  run directory, emits no bus events, and executes no steps.

## Source / Intent

Explorer run `2026-05-18T11-04-32-096Z-explorer-85c3ql` found an empty
actionable queue with all strategic blocked alternatives waiting on
operator-capture artifacts. Fresh primary-source review of GitHub Agentic
Workflows showed TrialOps as a mature adjacent pattern:

- https://github.github.com/gh-aw/patterns/trial-ops/
- https://github.com/github/gh-aw

The nonduplicative KOTA gap is not workflow definition validation; KOTA already
has dry-run and workflow-definition test harness coverage. The gap is a real,
side-effect-capturing workflow trial surface that executes production workflow
runtime logic against an isolated project before operators risk a live queue or
external channel.

## Initiative

Workflow operator safety: KOTA workflows should be testable at three distinct
levels - unit harness, dry-run plan, and isolated real execution - without
adding a parallel orchestration layer.

## Acceptance Evidence

- A CLI transcript under `.kota/runs/<run-id>/transcript.txt` showing a trial
  of a small fixture workflow mutating only the temporary project and writing
  a trial report.
- A trial report fixture under `.kota/runs/<run-id>/workflow-trial/` showing
  changed files, step statuses, event capture, and an explicitly blocked live
  external side effect.
- Focused `pnpm test` output for workflow-ops trial tests and existing dry-run
  regression tests.
