---
id: task-add-eval-harness-external-call-log-predicate-so-pr
title: Add eval-harness external-call-log predicate so pr-reviewer can enter agent-call-replay fixture coverage
status: done
priority: p2
area: modules
summary: Extend the eval-harness predicate contract with an external-call-log kind that observes a fake gh binary's invocations from PATH so the pr-reviewer workflow's external GitHub side effects become assertable; with that primitive in place, retire pr-reviewer from src/modules/eval-harness/fixtures/uncovered/notes.md by landing pr-reviewer-agent-call-replay alongside the other shipped workflow replay fixtures.
created_at: 2026-04-25T03:27:21.506Z
updated_at: 2026-04-25T03:48:23.429Z
---

## Problem

Every agent-step-bearing autonomy workflow now has an agent-call-replay
fixture except `pr-reviewer`. The retirement reason in
`src/modules/eval-harness/fixtures/uncovered/notes.md` is precise:
pr-reviewer's failure mode is an external `gh` CLI call, not a
repo-observable artifact or bus-event emission, and the harness
predicate vocabulary has no way to assert "this run invoked `gh pr
review` with these arguments." The same notes file calls out the two
candidate primitives — an `external-call-log` predicate or a shell-log
harness hook — but neither is built. As a result, regressions in
pr-reviewer's webhook routing, kota-task-branch gating, fork handling,
or final review-comment shape would only be caught by a live PR run
against a real GitHub repo, not by the eval-harness CI smoke gate that
covers every other workflow.

This is the last open seam in the agent-call-replay coverage initiative
that landed `decomposer-agent-call-replay`, `builder-agent-call-replay`,
`improver-agent-call-replay`, `explorer-agent-call-replay`,
`inbox-sorter-agent-call-replay`, and `research-retry-agent-call-replay`.
Closing it lets every shipped autonomy workflow with an agent step ride
the same `pnpm test` smoke gate.

## Desired Outcome

The eval-harness predicate contract gains an `external-call-log` kind
that asserts properties of recorded out-of-process command invocations
made by a workflow run. The fixture scaffold seeds a fake `gh` binary
(or equivalent shim) onto `PATH` for the duration of the run, the
binary appends each invocation to a JSONL log under the run directory,
and the predicate runs against that log. Predicates can match on
binary name, argv shape, and exit-code class; predicate failure
returns the same structured outcome as every other predicate kind so
the harness CLI summarizes it in the existing report.

A `pr-reviewer-agent-call-replay` fixture lands alongside the other
shipped replay fixtures, replays a real pr-reviewer run from
`.kota/runs/`, and exercises the full webhook-payload assessment +
agent step + post-comment shell-out path. The retirement entry for
pr-reviewer in `uncovered/notes.md` is removed in the same commit.

## Constraints

- The new predicate kind extends the typed predicate union in code; no
  parallel YAML schema. Reuse the existing predicate contract loader
  and outcome reporter — do not introduce a second predicate-result
  shape.
- The fake-binary shim is fixture-scoped, not a global harness mode.
  Each fixture that opts in declares which binary names it shadows;
  the harness puts the shim directory at the front of `PATH` for that
  run only and tears it down on completion.
- The shim records argv exactly as observed; it never normalizes,
  re-quotes, or interprets argv. The predicate is responsible for any
  matching tolerance it wants to express.
- Stay aligned with the existing replay surface (`replay-harness.ts`).
  pr-reviewer's agent step is replayed from a recorded source run
  exactly like decomposer, builder, and improver — no live LLM call.
  The new predicate composes with replay; it does not replace it.
- Do not add a second public DSL for matching argv. Use a typed
  predicate config in code (string match, prefix match, includes-arg
  match) — small enumerated set, extends only on demonstrated need.
- Failure of the new predicate kind on its own fixture run is a hard
  test failure, exactly like every other predicate kind. No "soft"
  warnings.
- Retire pr-reviewer from `uncovered/notes.md` in the same commit that
  ships the new predicate and fixture. Two ways of describing
  pr-reviewer's coverage status would create the kind of doubled
  surface the autonomy AGENTS.md forbids.

## Done When

- The eval-harness predicate types include `external-call-log` with a
  documented argv-matching shape, and the loader / runner / report path
  honour it end-to-end.
- A fixture-scoped fake-binary shim mechanism exists with at least one
  shadowed binary (`gh`) and is exercised by a real fixture, not just
  unit tests.
- `pr-reviewer-agent-call-replay` ships under
  `src/modules/eval-harness/fixtures/`, replays an existing real
  pr-reviewer source run, and asserts the expected `gh` invocation
  shape via the new predicate kind.
- `pnpm test` runs the new fixture as part of the smoke gate without a
  network round-trip or a real `gh` binary on the test host.
- `src/modules/eval-harness/fixtures/uncovered/notes.md` no longer
  retires pr-reviewer; the entry is removed and the surrounding prose
  trimmed accordingly.
- Focused tests cover the predicate's three failure modes
  (binary-not-invoked, argv-mismatch, exit-code-mismatch) so future
  pr-reviewer regressions in any of those classes flip the fixture red.

## Source / Intent

The agent-call-replay coverage initiative ran across a sustained burst
of seed/ship pairs between 2026-04-24 and 2026-04-25 (decomposer,
builder, improver, explorer, inbox-sorter, research-retry). The
`uncovered/notes.md` file explicitly preserves pr-reviewer as a typed
gap with a named blocker: an `external-call-log` predicate or a
shell-log harness hook. This task closes the named gap rather than
letting the last open seam in the coverage initiative drift.

## Initiative

Eval-harness coverage parity for every shipped autonomy workflow with
an agent step — when pr-reviewer joins the smoke-gated fixture set,
the agent-call-replay coverage claim becomes complete and any future
agent-step-bearing workflow has a clear precedent for both repo-
observable assertions and external-side-effect assertions.

## Acceptance Evidence

- `pnpm test` output shows `pr-reviewer-agent-call-replay` running
  inside the smoke gate without a real `gh` binary on `PATH` and
  without any network call.
- The new predicate kind is exercised by both the pr-reviewer fixture
  and the focused unit tests covering its three failure modes.
- `uncovered/notes.md` no longer carries a pr-reviewer retirement
  entry; the agent-call-replay coverage section reads cleanly without
  it.
- The fake-`gh` shim's recorded JSONL log is committed alongside the
  fixture as a frozen reference so future regressions show up as a
  diff, not a hand-edited assertion.

## Plan

- Extend the predicate union in `src/modules/eval-harness/` with the
  new `external-call-log` kind, including loader, runner, and report
  integration. Co-locate unit tests next to the predicate
  implementation.
- Add the fake-binary shim mechanism: a small executable script
  template plus the harness wiring that prepends a per-fixture shim
  directory to `PATH` and writes invocations as JSONL into the run
  directory. Cover with focused tests.
- Pick a real pr-reviewer source run from `.kota/runs/` (or capture
  one if none exists today) and scaffold
  `src/modules/eval-harness/fixtures/pr-reviewer-agent-call-replay/`
  in the same shape as the other agent-call-replay fixtures, with
  recorded agent step input/output, the `gh` shim entry, and the new
  predicate's expected log shape.
- Remove the pr-reviewer retirement entry from `uncovered/notes.md`.
- Run `pnpm test` end-to-end and confirm the new fixture rides the
  smoke gate alongside the others.
