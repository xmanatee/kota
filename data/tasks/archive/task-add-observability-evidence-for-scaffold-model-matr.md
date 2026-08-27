---
status: done
---

# Add observability evidence for scaffold model-matrix files

## Problem

Builder run 2026-06-27T10-17-38-365Z-builder-wmuuo5 completed scaffold weak/local model mode, but its observability diagnostic reports missing evidence for src/modules/harness-parity/model-matrix-contract.ts and src/modules/harness-parity/model-matrix-rows.ts.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-27T11-30-22-666Z-progress-reviewer-af8xdb.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-27T11-30-22-666Z-progress-reviewer-af8xdb.

review verdict: needs-steering
review summary: Needs steering. Balance: Product 0, Safety 1, Platform 7, Meta 0, Unclassified 9. Platform/Safety work is advancing, but the scaffold harness builder run left a concrete observability-obligation warning for model-matrix files that needs its own follow-up.

Evidence ids:

- event:evtj-000000115703
- git:commit:a4ad1e78497f

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A follow-up run or explicit artifact maps both model-matrix files to focused tests, structured runtime evidence, explicit rationale, or a justified waiver; the observability diagnostic reports no missing files for them; focused harness-parity/openai-tools tests, typecheck, lint, and validate-tasks pass.

## Result

Added focused assertions in `src/modules/harness-parity/model-matrix.test.ts`
that prove `HarnessParityMatrixRow` carries the full `scaffoldEvidence`
contract for both passed and skipped `openai-tools-scaffold` rows, and that
`model-matrix-report.json` serializes the same evidence objects.

## Evidence

- `.kota/runs/2026-06-27T12-43-12-849Z-builder-ezl2z6/observability-gap-resolution.json` replays the original `git:commit:a4ad1e78497f` production diff for both cited files with the new focused test diff; the observability diagnostic reports both files satisfied by `focused-test-assertion` and `missingFiles: []`.
- `.kota/runs/2026-06-27T12-43-12-849Z-builder-ezl2z6/observability-obligation-review.json` reports `OK: no staged production runtime-observability obligation candidates` for this follow-up diff.
- `pnpm -s test src/modules/harness-parity/model-matrix.test.ts`
- `pnpm -s test src/modules/harness-parity src/modules/openai-tools-agent-harness`
- `pnpm -s typecheck`
- `pnpm -s lint` (passed with existing informational style notices outside this change)
- `pnpm -s validate-tasks`
