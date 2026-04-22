---
id: task-validate-eval-harness-fixture-provenance-in-the-lo
title: Validate eval-harness fixture provenance in the loader
status: done
priority: p2
area: eval-harness
summary: Promote the 'real autonomy failure or justified smoke fixture' rule from social convention into an executable validation path in fixture.ts and the eval-harness CLI so contributions cannot ship undocumented fallback fixtures
created_at: 2026-04-21T15:53:26.236Z
updated_at: 2026-04-22T03:42:10.854Z
---

## Problem

The eval-harness contribution rule "fixtures come from real autonomy
failures, with a narrow smoke-fixture exception" is currently social, not
executable.

- `src/modules/eval-harness/fixture.ts` validates `fixture.json` shape and
  the `initial/` tree, but does not inspect `notes.md`, source run ids, or
  smoke-fixture justification.
- `src/modules/eval-harness/AGENTS.md` documents the provenance rule as a
  contribution requirement, so a fixture without a real failure anchor can
  still pass the loader today.
- This directly contradicts the autonomy harness decision that "eval
  fixtures come from real failures, not synthetic specs."

## Desired Outcome

Fixture provenance is enforced in code, not only in prose.

- Loader / CLI rejects fixtures that lack a documented real-failure source
  run id or an explicitly marked, justified smoke fixture.
- Failure modes are typed and point to the failing fixture directory.
- The AGENTS.md provenance rule becomes a pointer to the loader contract
  rather than the sole source of truth.

## Constraints

- Keep the rule strict: exactly two legal provenance shapes (real-failure
  fixture, justified smoke fixture). No undocumented fallback path.
- Do not silently coerce malformed `notes.md` into a passing fixture; fail
  loudly at load time.
- Validation runs in both the programmatic loader and the eval-harness CLI;
  no escape hatch that skips it in CI.
- Scope stays inside `src/modules/eval-harness/`.

## Done When

- `fixture.ts` parses and validates provenance metadata, rejecting fixtures
  that do not match one of the two legal shapes.
- A focused test covers happy path, missing provenance, and
  smoke-fixture-without-justification.
- The eval-harness CLI surfaces provenance errors with a clear message that
  names the fixture directory.
- `src/modules/eval-harness/AGENTS.md` references the loader as the
  enforcement point rather than restating the rule's mechanics.

