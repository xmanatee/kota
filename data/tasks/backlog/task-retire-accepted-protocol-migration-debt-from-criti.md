---
id: task-retire-accepted-protocol-migration-debt-from-criti
title: Retire accepted protocol-migration debt from critic warnings
status: backlog
priority: p1
area: architecture
summary: Close the concrete debt the critic accepted in recent protocol migrations: compatibility shims, placeholder tests, broad baselines, and textual-only guards.
created_at: 2026-04-29T12:53:21.055Z
updated_at: 2026-04-29T12:53:21.055Z
---

## Problem

Recent architecture/protocol migrations moved KOTA in the right direction, but
the critic accepted several concrete debts as warnings:

- `task-make-tool-effects-first-class`: many module tools still use
  `legacyEffect()` compatibility metadata, and `effect.test.ts` contains a
  placeholder assertion for a guard covered elsewhere.
- `task-enforce-strict-typescript-boundary-typing`: the strict-types ratchet
  locks in a broad baseline rather than reducing existing boundary-pattern
  usage; some owner-amplified nullability/critic-coordination intent was not
  visibly addressed.
- `task-neutralize-agent-harness-wire-protocol`: the guard against
  SDK-shaped neutral fields is textual and can be bypassed by renamed
  concepts.
- Several recent wide migrations accepted "reasonable but not literal"
  trade-offs without creating follow-up tasks.

Those warnings were legitimate short-term trade-offs, but leaving them only in
critic JSON means the next builder can unknowingly build on partial migrations.

## Desired Outcome

The accepted warning debt from recent protocol migrations is retired or turned
into explicit, narrowly-scoped follow-ups. The final state should be that the
protocol surfaces are truly first-class, strict, and guarded by behavior/type
tests rather than placeholder assertions or broad textual scans.

## Constraints

- Do not create a parallel audit/changelog/lesson surface. The task itself and
  resulting code/tests are the durable record.
- Prefer reducing compatibility shims and baselines over documenting them.
- Keep the work cohesive around accepted critic debt; avoid unrelated
  refactors.
- If a compatibility path must remain, make the remaining exception explicit,
  minimal, and enforced by tests.
- Coordinate with the critic-calibration task so future warnings like these
  become tracked automatically.

## Done When

- `legacyEffect()` usage is removed from production modules or reduced to a
  small named exception list with tests proving new tools cannot add legacy
  metadata.
- Placeholder/no-value assertions in the tool-effect test suite are removed or
  replaced with assertions that would fail on the intended regression.
- The strict-types baseline is reduced through real decoder migrations, and
  the regenerate path proves the baseline went down rather than merely stayed
  pinned.
- Harness-neutral protocol guards include semantic/type-level coverage for
  KOTA-native fields and adapter-owned translation, not only a banned-string
  scan.
- Recent critic warnings named in this task are either closed by code/tests or
  split into concrete follow-up tasks with owner-visible rationale.

## Source / Intent

Owner asked on 2026-04-29 for tasks that, if completed, would make KOTA
executions excellent rather than merely busy. This task preserves accepted
critic warnings from recent builder runs as actionable work instead of leaving
them buried under `.kota/runs/*/critic-review.json`.

## Initiative

Protocol completion quality: migrations should end with strict first-class
contracts, not compatibility debt hidden behind passing commits.

## Acceptance Evidence

- Test output showing tool-effect, strict-types, and agent-harness guard suites
  fail on representative regressions and pass after the cleanup.
- Before/after counts for `legacyEffect()` and strict-types baseline entries.
- A short run-directory note mapping each critic warning named here to its
  final disposition: fixed, intentionally retained with test guard, or split
  into a new task.
