---
status: done
---

# Resolve harness-parity scenario loader diagnostics

## Problem

Builder run 2026-06-28T23-20-45-779Z-builder-83fehs closed the confirmed scenario-id containment issue, but its post-build diagnostics still report missing observability evidence for src/modules/harness-parity/scenario.ts and source-size advisories for scenario.ts and scenario.test.ts.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T23-33-56-119Z-progress-reviewer-mebdfr.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Resolution

The cited progress gap is resolved as an evidence recheck, not a source split.
Run artifact `.kota/runs/2026-06-28T23-37-33-312Z-builder-iesl04/observability-obligation-recheck.json`
rechecks the cited commit diff for `b8e6319e62f4` and records
`outcome: ok`, `satisfiedFiles: ["src/modules/harness-parity/scenario.ts"]`,
and `missingFiles: []`, backed by
`.kota/runs/2026-06-28T23-37-33-312Z-builder-iesl04/observability-obligation-rationale.json`.

Run artifact `.kota/runs/2026-06-28T23-37-33-312Z-builder-iesl04/source-size-recheck.json`
covers the cited source-size advisories with line counts:
`scenario.ts` went from 596 lines in the parent commit to 636 lines in
`b8e6319e62f4` and remains 636 lines, while `scenario.test.ts` went from
1312 lines to 1343 lines and remains 1343 lines. This task did not modify
either oversized source file, so a source-size cleanup exception is not the
right mechanism for this diagnostics-only resolution.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T23-33-56-119Z-progress-reviewer-mebdfr.

review verdict: needs-steering
review summary: Needs narrow steering. Balance: Product 0, Safety 1, Platform 4, Meta 0, Unclassified 15. The reviewed KOTA batch landed the security fix with successful downstream monitors, no open dead letters, no owner questions, and no operator-journey risks, but the latest builder left untracked observability and source-size diagnostics on the harness-parity scenario loader.

Evidence ids:

- run:2026-06-28T23-20-45-779Z-builder-83fehs
- git:commit:b8e6319e62f4
- task:task-security-review-harness-parity-accepts-requested-s

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `.kota/runs/2026-06-28T23-37-33-312Z-builder-iesl04/observability-obligation-recheck.json`
  shows no `missingFiles` for `src/modules/harness-parity/scenario.ts`.
- `.kota/runs/2026-06-28T23-37-33-312Z-builder-iesl04/source-size-recheck.json`
  records before/after/current line counts for `src/modules/harness-parity/scenario.ts`
  and `src/modules/harness-parity/scenario.test.ts`.
- `TMPDIR=/private/tmp pnpm test src/modules/harness-parity/scenario.test.ts src/modules/harness-parity/harness-parity-operations.test.ts`
  passed: 2 files, 37 tests.
- `pnpm run typecheck` passed.
- `pnpm run validate-tasks` passed.
