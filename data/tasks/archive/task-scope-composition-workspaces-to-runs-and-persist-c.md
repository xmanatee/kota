---
status: done
---

# Scope composition workspaces to runs and persist coordination snapshots

## Problem

KOTA's `composition` module includes a `workspace` tool that acts as a shared
blackboard for parent agents and delegated sub-agents. The implementation is
currently process-global and in-memory: `workspace-store.ts` keeps workspaces in
one module-level map, and its own lifecycle comment says workspaces live for the
duration of the process and are not persisted.

That is useful for short coordination, but it is the wrong evidentiary boundary
for autonomous runs. If a workflow uses `batch`, `delegate`, `map`, or a named
handoff with a shared workspace, the resulting coordination state is not
recoverable from the run directory. A later operator, critic, or repair workflow
cannot reconstruct which agent wrote which shared finding, which entries the
parent consumed, whether two runs accidentally reused the same workspace name,
or what state was lost on daemon restart.

## Desired Outcome

Make composition workspaces run-scoped and artifact-backed without turning them
into durable project memory.

At minimum:

- workspace names are resolved under a deterministic run/session scope so two
  concurrent or sequential runs cannot share state by name accidentally;
- workspace entries record bounded metadata such as key, author, created/updated
  timestamps, source run/session/step when available, and last writer;
- workflow runs that use the workspace tool emit a bounded artifact such as
  `.kota/runs/<run-id>/composition-workspaces.json` or per-workspace snapshots;
- snapshot artifacts are sanitized and bounded, with truncation diagnostics
  rather than raw unbounded tool payloads;
- restart or recovery behavior is explicit: in-flight workspace state is either
  restored from the current run artifact when safe or reported as unavailable
  instead of silently continuing with an empty process-global store; and
- existing `workspace` tool output remains concise for agents while the
  detailed coordination state stays operator/evaluator-visible in artifacts.

## Constraints

- Keep ownership in `src/modules/composition/` and existing workflow/run
  artifact helpers. Do not move the workspace primitive into core.
- Do not create a second memory, knowledge, task, or lesson store. These
  snapshots prove coordination for one run; they are not durable semantic
  memory.
- Do not expose run-artifact summaries, token/cost fields, raw prompts,
  approval payloads, credentials, or full large tool results back into later
  autonomy-agent prompts.
- Preserve normal single-session workspace use. Existing agents should not need
  to pass a run id manually when the tool runner context can provide one.
- Keep artifacts deterministic and bounded so a runaway workspace cannot fill
  `.kota/runs/` or balloon later context.

## Done When

- The composition workspace store has an explicit scope key derived from the
  active run/session context, with tests proving same-name workspaces from
  different runs do not collide and same-run agents still share entries.
- Workspace write/read/delete operations retain current behavior for agents but
  record enough metadata to reconstruct the coordination history for the run.
- Workflow or tool execution writes a bounded coordination snapshot artifact for
  runs that used workspace entries, and no artifact for runs that never touched
  the workspace tool.
- Recovery/restart behavior is covered by tests: either scoped workspace state
  is restored from the active run artifact or a deterministic unavailable
  diagnostic is written instead of silently using stale or empty global state.
- Focused tests cover cross-run isolation, concurrent same-run writes,
  snapshot truncation/sanitization, delete semantics, and old/no-context tool
  calls.
- Existing composition module tests and relevant workflow artifact tests still
  pass.

## Source / Intent

Explorer run `2026-06-24T14-58-09-795Z-explorer-c5pxoc` saw
`strategicReadyCoverageGap=true`: the ready queue contained only a p3 Meta
cleanup task, the backlog was empty, and all surfaced strategic blocked
alternatives still required operator-captured evidence. Those blocked tasks
could not honestly be promoted.

Blocked strategic alternatives considered but not chosen:

- `task-add-a-scientific-claim-reproduction-fixture-to-the` still requires the
  `.kota/runs/scientific-claim-reproduction-live-pass/` operator-captured live
  eval artifact.
- `task-add-algorithmic-resource-budget-canaries-to-the-ev` still requires the
  `.kota/runs/algorithmic-resource-budget-canary-live-pass/` operator-captured
  live eval artifact.
- `task-add-an-unfamiliar-language-strategy-construction-f` still requires the
  `.kota/runs/unfamiliar-language-strategy-construction-live-pass/` operator-
  captured live eval artifact.
- `task-add-cross-preset-runtime-parity-gate` still requires the
  `.kota/runs/preset-parity-all-keys-set/` operator transcript pair with real
  provider auth.
- `task-capture-an-end-to-end-coding-task-parity-artifact-` still requires the
  all-registered-harness `.kota/runs/harness-parity-*` capture.

External source checked:

- `https://arxiv.org/abs/2605.18747` ("Code as Agent Harness", submitted May
  18, 2026) frames code as infrastructure for agent reasoning, action,
  environment modeling, and execution-based verification. Its relevant
  multi-agent signal is not a new framework import: it highlights shared code
  artifacts for coordination/review/verification and names consistent shared
  state across multiple agents as an open harness-engineering challenge.

Local overlap check:

- `task-add-named-agent-handoff-protocol` added typed named-agent handoffs with
  trace links, budgets, tool policy, and structured results. It does not make
  the composition workspace run-scoped or persist shared blackboard state as a
  reconstructible run artifact.
- `task-add-rollout-token-budgets-to-workflow-agent-runs` shares token-budget
  ledgers with delegated and named-agent children. It does not address shared
  coordination state or workspace artifact recovery.
- Existing control-monitor coverage and review-scrutiny work reports which
  controls and reviewers covered a run, not what shared workspace entries
  multi-agent coordination produced or consumed.
- The `composition` module already owns `workspace`; this task tightens that
  module's runtime/evidence boundary instead of adding another coordination
  primitive.

## Initiative

Reconstructible multi-agent coordination: KOTA's agent collaboration surfaces
should be scoped, replayable from run artifacts, and module-owned.

## Acceptance Evidence

- Diff showing the scoped workspace store, metadata model, run-artifact writer,
  and any workflow/tool-runner context threading needed to derive the active
  run/session scope.
- Focused test transcript for `src/modules/composition/` covering cross-run
  isolation, same-run sharing, truncation/sanitization, delete behavior, and
  old/no-context compatibility.
- Focused workflow/run-artifact test transcript showing a workspace-using run
  writes the coordination snapshot and a non-workspace run does not.
- Sample `.kota/runs/<run-id>/composition-workspaces.json` or equivalent
  artifact with sanitized entries, authors, timestamps, run/session/step refs,
  and truncation diagnostics where applicable.
- `pnpm run validate-tasks` passes after the task is completed or moved.

Run evidence: `.kota/runs/2026-06-24T15-35-56-095Z-builder-eaxkbt/`.
