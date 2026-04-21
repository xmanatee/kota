---
id: task-add-explorer-eval-harness-fixture-seeded-from-a-re
title: Add explorer eval-harness fixture seeded from a real strategic-ready trip
status: ready
priority: p2
area: autonomy
summary: Extend eval-harness fixture coverage to the explorer workflow by encoding a real task-queue-valid or strategic-ready-coverage repair trip from .kota/runs as a runnable fixture, so the recurring 15-25 minute repair-loop cost is gated against future regression
created_at: 2026-04-21T00:43:14.048Z
updated_at: 2026-04-21T00:43:14.048Z
---

## Problem

`src/modules/eval-harness/fixtures/` covers only `builder` and `inbox-sorter`
(three real-failure fixtures plus two smoke fixtures across the two
workflows). The other autonomy workflows have no fixture coverage. The
autonomy module's `AGENTS.md` is explicit that "Eval fixtures come from real
failures, not synthetic specs. Seed the eval-harness module from `.kota/runs/`
failures first." — that mandate has not yet been applied to the workflows
beyond `builder` and `inbox-sorter`.

The `explorer` workflow is the most concrete first extension target. Its own
local `AGENTS.md` records two recurring repair-loop trips with a measured
cost: when explorer leaves `data/tasks/ready/` empty (`task-queue-valid`) or
fills `ready/` with only `p3` work (`strategic-ready-coverage`), the explorer
agent re-runs and the repair loop "consistently burns 15–25 minutes of repair
work per occurrence." Both repair-loop conditions correspond to identifiable
runs in `.kota/runs/` and are deterministic enough to encode as predicates
against the fixture working directory after the workflow runs.

Without an evaluator-side fixture, a future change that re-introduces either
trip (for example, by softening explorer's prompt, weakening the repair-check
predicate, or shifting the task-queue invariants) cannot be caught by
`pass^k`. The cost stays externalized into autonomy minutes and operator
attention.

## Desired Outcome

`src/modules/eval-harness/fixtures/explorer-strategic-ready-trip/` (or a
similarly-named real-failure fixture) exists with the standard fixture shape
defined in `src/modules/eval-harness/AGENTS.md`:

- `fixture.json` declares `id`, `description`, `role: autonomous`,
  `workflowName: explorer`, an honest `budgetMs`, and a non-empty
  `predicates` array that asserts the post-run state explorer is supposed to
  reach (for example: `data/tasks/ready/` non-empty AND at least one task
  there is not `p3`, modeling the `strategic-ready-coverage` invariant).
- `initial/` materializes a minimal repo state that reproduces the trigger
  conditions of a real `.kota/runs/` explorer run (thin queue, `ready/`
  empty or only `p3`).
- `notes.md` names the source `.kota/runs/` run id, summarizes the failure,
  and explains why the chosen predicates capture it.

The fixture passes when the explorer workflow correctly populates a
strategic task in `ready/` end-to-end through `runFixture`, and fails when
the workflow either leaves `ready/` empty or only adds `p3` work — matching
the real repair-loop contract.

## Constraints

- Source the fixture from a real `.kota/runs/` explorer failure or
  repair-loop trip, not from a hypothetical scenario. The `notes.md` must
  name the run id (no smoke-fixture exception — `explorer` is the third
  workflow under coverage and a real-failure fixture is the right seed).
- Use only the existing `FixturePredicate` kinds (`file-exists`,
  `file-absent`, `file-contains`, `shell-succeeds`, `shell-fails`). If
  expressing the strategic-ready invariant requires composing several
  shell-succeeds checks, do that rather than extending the predicate
  protocol; only reach for a new predicate kind if multiple future fixtures
  will need it.
- Do not relax the explorer workflow, its repair-checks, or its prompt to
  make the fixture pass. The fixture is the gate; the workflow keeps its
  current contract.
- Keep `initial/` minimal: include only the `data/tasks/`, `.kota/`, and
  repo scaffolding the explorer workflow actually reads. Do not vendor
  unrelated repo state.
- Run sequentially under the existing `runFixture` / `runEvalSet` path. Do
  not introduce a parallel runner or a special-case explorer entry point.
- Respect the existing autonomy rule that no cost signals leak into
  agent-facing context (eval-harness AGENTS.md "Boundaries").

## Done When

- The new fixture directory exists under
  `src/modules/eval-harness/fixtures/` with `fixture.json`, `initial/`, and
  `notes.md` populated per the format above.
- `pnpm kota eval list` discovers the new fixture id.
- `pnpm kota eval run --fixture <new-id> --repeats 1` exercises the
  explorer workflow against the materialized initial state and reports a
  pass/fail outcome consistent with the predicates.
- `notes.md` cites the source run id and explains the encoded failure mode.
- `pnpm typecheck`, `pnpm test`, and `pnpm lint` pass on the final tree.
- No change to `eval-harness/AGENTS.md` semantics; if the file mentions
  fixture-coverage scope, update it to reflect that `explorer` is now
  covered.
