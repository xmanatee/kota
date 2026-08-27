---
status: done
---

# Split oversized harness-parity runner test surface

## Problem

Recent harness-parity security and observability fixes landed, but both touched src/modules/harness-parity/runner.test.ts and left source-size advisories; the latest run reports the file at 1972 lines. Split cohesive runner test scenarios or record a narrow source-size exception so future harness-parity maintenance does not keep producing untracked advisories.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-28T22-51-30-539Z-progress-reviewer-24yiym.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-28T22-51-30-539Z-progress-reviewer-24yiym.

review verdict: needs-steering
review summary: Mostly successful maintenance progress, but one narrow follow-up is needed. Balance: Product 0, Safety 1, Platform 4, Meta 0, Unclassified 13. Recent builders closed the security and observability tasks, while the latest harness-parity work still leaves runner.test.ts above the source-size guideline.

Evidence ids:

- artifact:2026-06-28T22-16-49-836Z-builder-29k8rz:source-file-size-review.json
- run:2026-06-28T22-40-29-521Z-builder-k539ds
- git:commit:6c2da576d299

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Before: `src/modules/harness-parity/runner.test.ts` was 1,972 lines and triggered the source-size guideline.
- After: `runner.test.ts` is replaced by focused runner test files plus `runner.test-support.ts`; every changed runner test/support file is below 300 lines, with the largest split file at 261 lines.
- Staged-state source-size check passed: `checkSourceFileSize(process.cwd())` returned `OK: changed source files are under source-size warning thresholds`.
- Focused validation passed: `pnpm test src/modules/harness-parity/runner-*.test.ts` reported 10 files and 23 tests passing.
- Type validation passed: `pnpm typecheck`.
- Queue validation passed against the intended staged state with a temporary git index: `pnpm validate-tasks`.
