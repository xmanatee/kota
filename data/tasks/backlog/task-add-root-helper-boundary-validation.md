---
id: task-add-root-helper-boundary-validation
title: Add validation for root helper drift
status: backlog
priority: p2
area: validation
summary: Root src helper drift should be caught automatically so future agents do not recreate broad #root utility buckets.
created_at: 2026-04-11T01:44:06Z
updated_at: 2026-04-11T01:44:06Z
---

## Problem

The repo now has source-aware imports and local guidance, but root helper files
can still accumulate silently. Agents may add new `src/*.ts` helpers or new
`#root/*` imports because that remains technically valid.

## Desired Outcome

Existing validation should flag unexpected root helper drift while allowing the
small set of intentional root entrypoints and thin glue files.

## Constraints

- Add this to an existing validation or repair-check path; do not create a
  parallel checker surface.
- Keep the allowlist short and explicit.
- The check should guide agents toward `src/core/` or `src/modules/`, not merely
  complain.
- Do not fail on test files unless they introduce production-like root helpers.

## Done When

- New non-entrypoint `src/*.ts` production files are flagged.
- New production imports from disallowed `#root/*` helper paths are flagged.
- The allowlist is documented close to the validation code.
- The check is covered by focused tests.
