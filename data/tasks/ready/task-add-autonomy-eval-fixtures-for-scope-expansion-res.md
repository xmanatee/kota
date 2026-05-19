---
id: task-add-autonomy-eval-fixtures-for-scope-expansion-res
title: Add autonomy eval fixtures for scope-expansion restraint
status: ready
priority: p2
area: autonomy
summary: Seed eval-harness coverage that proves builder and critic treat out-of-scope helpful edits and no-op opportunities as authorization-boundary behavior, not just implementation quality.
created_at: 2026-05-19T18:17:19.473Z
updated_at: 2026-05-19T18:17:19.473Z
---

## Problem

KOTA has several autonomy quality rails, but they mostly guard against
oversized tasks, missing Done-When coverage, weak evidence, and malformed
workflow behavior. They do not yet give the eval harness a focused signal for
two adjacent failure modes now showing up in coding-agent research:

- an agent makes extra "helpful" changes outside the user's authorized task
  boundary;
- an agent edits code when the correct outcome is to verify that no production
  patch is needed.

Those are not just style or capability failures. They are authorization and
restraint failures in an autonomous workflow that can mutate a repo.

## Desired Outcome

The autonomy eval harness includes focused coverage that makes scope
expansion and no-op restraint visible to KOTA's normal builder / critic /
repair-loop path. The coverage should prove that KOTA can distinguish "task
completed with only authorized changes" from "task completed plus unrelated
extra work", and that a builder can complete a task honestly when the correct
patch is no production edit.

## Constraints

- Use the existing eval-harness fixture machinery; do not add a parallel
  benchmark runner or external benchmark import.
- Respect `src/modules/eval-harness/AGENTS.md`: use a real-failure fixture if
  suitable run evidence exists; otherwise make any synthetic case a
  `smoke-fixture` with a written justification naming the harness invariant it
  protects.
- Keep the fixture count small. One scope-expansion canary plus one no-op /
  already-fixed canary is enough unless implementation evidence shows a
  narrower shape is better.
- Do not solve this with prompt text alone. The outcome needs deterministic
  predicates or critic-visible artifacts that fail when unrelated files change
  or when a no-op task is dishonestly marked as implemented.
- Do not add hardcoded pre-agent task policing to the builder. Builder local
  guidance says to prefer validation rails over scope policing.
- If the research source changes the design decision, record the durable
  guidance at the narrowest useful `AGENTS.md` rather than expanding global
  docs.

## Done When

- The eval harness has deterministic coverage for an out-of-scope edit case:
  a run that changes files beyond the task's authorized outcome fails through
  artifact predicates, critic calibration, or both.
- The eval harness has deterministic coverage for a no-op restraint case:
  a task whose correct result is "already satisfied" can pass without a
  production patch, while an unnecessary patch fails.
- Fixture provenance is valid under the eval-harness loader, including
  explicit `real-failure` source run ids or `smoke-fixture` justification.
- Any critic prompt or repair-loop wording changed by this task classifies
  unauthorized extra edits as a critical issue only when the task contract
  makes the boundary inspectable.
- The relevant eval-harness smoke test, fixture listing, and the narrow tests
  for any changed predicate / critic plumbing pass.

## Source / Intent

Fresh external research surfaced a gap that is narrower than KOTA's existing
scope-size guard:

- `https://arxiv.org/abs/2605.18583` (`Overeager Coding Agents`, 2026-05-18)
  frames out-of-scope helpful edits on benign tasks as an authorization
  problem distinct from prompt injection or sandbox escape.
- `https://arxiv.org/abs/2605.07769` (`Coding Agents Don't Know When to Act`,
  2026-05-08) reports that coding agents often patch stale/already-fixed
  issues where abstaining from a production edit is the correct result.

KOTA's task contract already says the task is a contract, not a script. This
task turns that norm into eval evidence so future autonomy changes do not
quietly reward over-eager edits.

## Initiative

Autonomy quality and authorization boundaries: KOTA should complete the
operator's task, not opportunistically mutate nearby state.

## Acceptance Evidence

- A committed eval-harness fixture or fixtures plus a `pnpm kota eval list`
  transcript showing valid provenance.
- The narrow test command(s) for changed predicate / critic / fixture
  plumbing.
- A fixture run artifact or transcript showing the restraint case passing and
  the scope-expansion failure case failing for the intended reason.
