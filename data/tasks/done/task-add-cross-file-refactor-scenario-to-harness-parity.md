---
id: task-add-cross-file-refactor-scenario-to-harness-parity
title: Add cross-file refactor scenario to harness-parity pack
status: done
priority: p2
area: architecture
summary: Add a fifth harness-parity scenario whose verification fails unless the agent updates every call site of a renamed function across multiple files; isolates the cross-file-refactor consistency property the existing four scenarios do not cover.
created_at: 2026-04-28T19:59:28.399Z
updated_at: 2026-04-28T20:15:29.722Z
---

## Problem

The harness-parity scenarios pack now ships four coverage points: smoke /
plumbing (`fix-arithmetic-bug`), multi-file multi-turn writing
(`extract-shared-helper`), tool-result carry-over fidelity
(`revise-from-test-output`), and project navigation under realistic
distractors (`discover-failing-source`). Each isolates a different blast
radius the parity claim depends on.

The pack does not yet isolate one property real refactor work depends on:
**cross-file consistency under rename**. When an operator says "rename
function `oldName` to `newName`", the agent must update every call site
across multiple files. A harness that makes the obvious first edit (the
function definition) and stops, or that updates the definition plus one
caller, will leave a partial state where some files compile or test green
in isolation but the project as a whole is broken. The four current
fixtures do not catch this: the smoke and revise fixtures touch one file,
the multi-file fixture writes new files derived from inputs (not rename
discipline), and the discovery fixture is a single-edit fix.

## Desired Outcome

A fifth scenario lives at
`src/modules/harness-parity/scenarios/<id>/` (suggested id:
`rename-across-files`). Its `initial/` tree contains a small Node.js
project with one function defined in `src/<name>.js` and called from
**three or more** other source files (plus `test.js`, which the agent
must not modify). The function's current name is generic enough that the
prompt can name the new name without giving away the call-site list.

The verification is a single shell command — `node test.js` — that
exercises the renamed function through every call site and exits 0 only
when **all** call sites have been updated. A run that renames the
definition and even half the call sites must fail verification, because
the unchanged callers reference an undefined symbol that crashes when
their code path runs. The test file therefore exercises every distinct
caller, not just the directly-imported one. `test.js` itself does not
import the renamed function — every reference goes through one of the
caller files.

The prompt names the rename target ("rename function `oldName` to
`newName`") and the verification command, but does not enumerate the
caller files. The agent must search the project to find every call site
and update them. The scenario stays self-contained per the module's
existing scope rules: no external deps, no network, no test-time
fabrication of expected output.

The module's `AGENTS.md` "Scenario Coverage" section gains a fifth
bullet naming the cross-file-refactor dimension and the property a
non-rename-disciplined harness fails to satisfy ("touched the
definition but missed at least one call site"). The do-not-delete rule
extends to all five fixtures.

## Constraints

- Stay inside the harness-parity module's stated scope. No scoring,
  regression gates, or pass^k aggregation. The fixture is parity
  evidence, not capability gating.
- Verification stays a single shell command whose exit status is the
  pass/fail signal. No multi-step verification chains.
- The `initial/` tree must be small (one entry plus the renamed source
  plus 3+ callers plus `test.js`); resist scaling for its own sake.
  Realistic distractor files are fine if they reinforce that the agent
  cannot trivially enumerate every caller from a one-file glance, but
  the scenario's job is to isolate rename discipline, not project
  navigation.
- The prompt must name the rename ("rename `oldName` to `newName`") and
  the verification command, and must not name the caller files.
- The scenario-loader test bumps the pack count to five, asserts the
  new fixture loads, asserts the prompt names the rename target, and
  asserts the fixture is solvable only when every caller file is
  edited (a partial-rename diff must fail verification — encode this as
  a focused test that materializes the initial tree, applies a partial
  rename, runs `node test.js`, and asserts non-zero exit).
- Keep the new fixture cleanly orthogonal to the four existing
  fixtures — do not duplicate plumbing, multi-file write, tool-result
  fidelity, or discovery axes.
- Follow the module's existing fixture format: `scenario.json` with
  `id` / `description` / `prompt` / `verification`, plus an
  `initial/` directory that is the starting working tree.
- No production code or runner changes are required; this lands inside
  the scenarios pack and the loader test.

## Done When

- `src/modules/harness-parity/scenarios/<id>/scenario.json` exists with
  the prompt, description, and verification.
- The fixture's `initial/` tree carries one entry, one renamed source,
  three or more caller files, and a `test.js` that exercises every
  caller path.
- A focused test in `scenario.test.ts` (or a sibling fixture-shape
  test) asserts:
  - The pack now contains five scenarios.
  - The new fixture loads cleanly through the existing loader.
  - The prompt mentions the rename target and verification command but
    does not enumerate the caller files.
  - A partial rename (definition + one caller, but at least one caller
    untouched) leaves verification failing.
  - A complete rename across every caller passes verification.
- `src/modules/harness-parity/AGENTS.md` "Scenario Coverage" gains a
  fifth bullet describing the cross-file-refactor dimension; the
  do-not-delete rule extends to five fixtures.
- `pnpm test` and `pnpm typecheck` pass.

## Source / Intent

The 2026-04-28 explorer pivoted the queue from the cross-store
correction-loop initiative into the coding-agent parity initiative,
seeding `discover-failing-source` (commit 1f6faadb). The pack now
covers plumbing, multi-file write, tool-result carry-over, and project
navigation. The next coverage point a realistic operator-driven coding
session leans on is rename-and-update-every-caller — a property a
harness that makes one edit and stops, or that "fixes" only files it
already opened, silently fails. Real refactors break the project when
even one call site is missed, and the parity claim ("general-purpose
coding agent across pluggable harnesses") rests on the harness
maintaining cross-file consistency under rename.

This task continues the coding-agent parity initiative explicitly named
by the 2026-04-28 fcfc802a explorer commit message; it is not a
queue-collapse repeat because the initiative's current depth is two
commits.

## Initiative

Coding-agent harness parity: KOTA must hold a runnable scenarios pack
that isolates each capability dimension the "general-purpose coding
agent across pluggable harnesses" claim depends on. Operators read
`parity.json` and per-harness `trace-summary.md` to compare adapters;
each scenario in the pack pins one property whose silent failure
collapses the claim.

## Acceptance Evidence

- The scenario directory and `scenario.json` are committed.
- `pnpm test --filter scenario` (or the closest existing form) shows
  the loader recognizing five scenarios and the new partial-rename
  test failing exactly when the rename is incomplete.
- The updated `AGENTS.md` lists five coverage bullets.
- The diff is contained: scenarios pack + loader test + `AGENTS.md`,
  no runner or operations changes.
