---
status: done
---

# Add observability evidence for decoder and provider split surfaces

## Problem

Builder run 2026-06-25T02-14-28-199Z-builder-wx6wqu resolved the source-size split but its observability-obligation review reports 13 runtime-sensitive conformance decoder and core provider split files without inspectable structured logging, event, run-artifact, explicit error-result, focused test assertion, or waiver rationale.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-25T02-37-35-003Z-progress-reviewer-yow6wq.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-25T02-37-35-003Z-progress-reviewer-yow6wq.

review verdict: needs-steering
review summary: Needs one observability follow-up. Balance: Product 1, Safety 2, Platform 5, Meta 1, Unclassified 11. Recent source-size cleanup landed successfully and the queue is being replenished, but the latest builder run left unresolved observability-obligation warnings.

Evidence ids:

- run:2026-06-25T02-14-28-199Z-builder-wx6wqu
- artifact:2026-06-25T02-14-28-199Z-builder-wx6wqu:observability-obligation-review.json
- task:task-handle-work-memory-provenance-source-size-advisori
- git:commit:16aaf43c2027

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A follow-up builder run or explicit run artifact maps each of the 13 missing files to inspectable observability evidence or an explicit waiver rationale, the observability-obligation diagnostic reports no unresolved missing files for this change, focused conformance/provider validation passes, and task validation passes.

## Completion Evidence

- `.kota/runs/2026-06-25T16-20-08-179Z-builder-3xhc1y/decoder-provider-observability-evidence.json` maps each of the 13 cited files to explicit decoder failure surfaces, focused conformance/provider assertions, typecheck evidence, or run-artifact rationale; `missingFiles` is empty.
- `.kota/runs/2026-06-25T16-20-08-179Z-builder-3xhc1y/observability-obligation-rationale.json` records one explicit rationale entry for each cited missing file while preserving the prior evidence ids from run `2026-06-25T02-14-28-199Z-builder-wx6wqu`.
- `.kota/runs/2026-06-25T16-20-08-179Z-builder-3xhc1y/observability-obligation-review.json` records the current-change diagnostic outcome: `ok`, with no unresolved missing files.
- Focused validation passed: root conformance/provider tests (`4` files, `54` tests), web decoder tests (`2` files, `84` tests), mobile decoder tests (`2` suites, `81` tests), and `pnpm run typecheck`.
- Task validation passed against the real staged index after `git add -A` staged the ready-to-done task move; `.kota/runs/2026-06-25T16-20-08-179Z-builder-3xhc1y/validation.txt` records the command results.
