---
status: done
---

# visible changed source size guard

## Problem

Large production files have grown without a changed-file-only source-size hygiene guard. Existing `doc-bloat` and `repo-hygiene` patterns are the right model, but untouched legacy large files must not cause noise or block unrelated builders.

## Desired Outcome

Add an advisory source-size warning for changed source files. V1 warns when a touched code file is over 300 lines, or when a touched file grows by more than 150 lines and ends over 300 lines. Warnings are visible in run metadata or run summary as `source-file-size`.

## Constraints

- Advisory only in V1; do not block commits until warning volume is calibrated.
- Only evaluate changed source files. Untouched legacy large files must never warn.
- Exclude generated, build, vendored, and other existing ignored/generated directories.
- Align naming and artifact shape with `doc-bloat` and `repo-hygiene` conventions.
- Use warning shape `{ type: "source-file-size", file, lines, threshold, changedLines, message }`.

## Done When

- Changed source files over 300 lines produce `source-file-size` warnings.
- Changed files growing by more than 150 lines and ending over 300 lines produce `source-file-size` warnings.
- Untouched oversized source files do not warn in a local static probe.
- The warning is promoted into run metadata or run summary where agents and later assessment can see it.

## Product / Safety Link

Oversized touched files make Product and Safety repairs harder to review and are one of the signals needed by the scope-improver evidence gate. Changed-file-only warnings reduce future file growth without punishing untouched legacy debt.

## Source / Intent

Owner follow-up on 2026-06-19: large files are scary and should be addressed. The guard must be smart: warn only for files a builder touched, preferably nonblocking first, so unrelated legacy debt does not explode ordinary work.

## Initiative

Autonomy maintainability and review hygiene.

## Acceptance Evidence

- Run artifact: `.kota/runs/2026-06-20T00-00-51-800Z-builder-201tp5/source-file-size-evidence.json` records the warning shape, run-summary snippet, exclusion list, and verification commands.
- `pnpm test src/modules/autonomy/source-size-check.test.ts src/modules/autonomy/workflows/builder/run-summary.test.ts src/modules/autonomy/workflows/builder/workflow.test.ts` passed: 3 files, 70 tests.
- `pnpm run typecheck` passed.
