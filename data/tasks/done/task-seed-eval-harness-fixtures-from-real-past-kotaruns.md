---
id: task-seed-eval-harness-fixtures-from-real-past-kotaruns
title: Seed eval-harness fixtures from real past .kota/runs failures
status: done
priority: p1
area: autonomy
summary: Grow the fixture set by synthesizing fixtures from real past autonomy-run failures in .kota/runs rather than hypothetical specs, closing the demystifying-evals anti-pattern the harness module already documents.
created_at: 2026-04-20T09:11:49.532Z
updated_at: 2026-04-20T10:06:27.420Z
---

## Problem

The autonomy eval harness landed with only two fixtures
(`builder-trivial-edit`, `inbox-sorter-smoke`), both synthesized from
hypothetical happy-path specs. The module's own `AGENTS.md` and the
Anthropic "demystifying evaluations" takeaway both call out the
anti-pattern explicitly: fixtures assembled from hypothetical tasks,
rather than from real failures, reward cosmetic progress on capability
we already have and miss the failure modes the harness exists to gate
against. Until the fixture set reflects actual past failures from
`.kota/runs/`, a green regression gate is not a real ship signal — it
just says the agent still passes the two demos it was designed around.

## Desired Outcome

- The fixture set grows to cover several distinct historical failure
  modes drawn from real `.kota/runs/` evidence (dirty-worktree recovery,
  malformed commit attempt, critic rejection loop, runtime-probe
  failure, injection-defense coverage, etc.), not hypothetical happy
  paths.
- Each added fixture has a short `notes.md` in its directory that names
  the source run id, what failed, and why this fixture captures that
  failure — so future contributors see the traceability and cannot
  drift back into synthetic specs.
- The harness's scoring and gate semantics are unchanged; only the
  fixture inventory and selection discipline change.
- The existing `builder-trivial-edit` and `inbox-sorter-smoke` fixtures
  are kept if and only if they still exercise a distinct capability
  axis; if they overlap with a real-failure fixture, they are removed
  rather than carried as legacy.
- The eval-harness module AGENTS.md is updated to make real-run
  sourcing a stated requirement, not an aspiration: new fixtures must
  cite a source run id or explain why none is applicable.

## Constraints

- Fixtures live where they already live (`src/modules/eval-harness/fixtures/<id>/`).
  Do not invent a parallel fixture store.
- Do not weaken or reshape predicates to make a flaky run pass. If a
  real failure cannot be reduced to a deterministic predicate over the
  final working directory, reshape the fixture or pick a different
  run — do not add judgment-based predicates.
- Keep fixture `initial/` trees minimal. Include only the repo state the
  target workflow actually needs to reproduce the failure; do not copy
  unrelated modules, runs, or history.
- Each fixture must run under the existing subprocess executor
  (`kota workflow trigger`) without special-case handling. A failure
  mode that needs a new harness surface belongs in a separate task.
- Respect the "no cost signals leak into agent-facing context" rule —
  fixture metadata stays operator-facing, not injected into agent
  prompts.
- Do not collapse `pass@k` / `pass^k` reporting or mutate the noise
  band as a side effect; this task is about inputs, not scoring.

## Done When

- At least three new fixtures are merged, each sourced from a distinct
  real run failure, with a `notes.md` citing source run id and failure
  shape.
- Each new fixture passes when run against HEAD (the failure they
  encode has been fixed) OR is explicitly tagged as a currently-open
  regression the harness should flag — no silently-failing fixtures.
- `pnpm kota eval list` shows the expanded set; `pnpm kota eval run`
  executes them under the existing resource-profile contract without
  harness changes.
- `src/modules/eval-harness/AGENTS.md` names real-run sourcing as a
  requirement for new fixtures, not a preference, and the "How To Add
  A Fixture" section references the `notes.md` convention.
- Any fixture removed because it overlaps a real-failure fixture is
  deleted cleanly (no legacy wrappers, no re-export shims).
