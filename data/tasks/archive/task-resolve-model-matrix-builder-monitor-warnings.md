---
status: done
---

# Resolve model-matrix builder monitor warnings

## Problem

Add or justify observability evidence for the daemon-client test stub change from the model-matrix builder run, and handle the touched source-size advisories so future builder diagnostics do not leave the same warnings untracked.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-27T02-12-24-498Z-progress-reviewer-p7y37h.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-27T02-12-24-498Z-progress-reviewer-p7y37h.

review verdict: needs-steering
review summary: Needs steering: the 24h packet is Platform-heavy with Product 0, Safety 1, Platform 7, Meta 0, and Unclassified 4. The main model-matrix work landed and is honestly blocked on operator-captured live-key evidence, but four workflow DLQs remain open and the latest builder left unresolved monitor warnings.

Evidence ids:

- run:2026-06-27T00-33-10-684Z-builder-wtiy1i
- git:commit:e5d6ccbef8d2

## Result

Added focused daemon-client coverage for the shared migrated harness-parity matrix stub and reduced `src/core/server/daemon-client-test-stubs.ts` below the source-size threshold. The run artifact `.kota/runs/2026-06-27T03-03-16-056Z-builder-18hkkb/monitor-warning-diagnostics.json` records observability `ok` with no missing files and source-size `ok` with no warnings for the repair diff. The original builder-run source-size advisory for `src/modules/harness-parity/runner.ts` remains a larger module cleanup and is now tracked by `data/tasks/task-split-oversized-harness-parity-runner-source-surfa.md`.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `.kota/runs/2026-06-27T03-03-16-056Z-builder-18hkkb/monitor-warning-diagnostics.json` shows observability-obligation diagnostics no longer report `src/core/server/daemon-client-test-stubs.ts` as missing and source-size diagnostics no longer warn for the changed source files.
- `data/tasks/task-split-oversized-harness-parity-runner-source-surfa.md` tracks the cited `src/modules/harness-parity/runner.ts` source-size advisory from `.kota/runs/2026-06-27T00-33-10-684Z-builder-wtiy1i/steps/build.json`.
- Focused validation passed: `pnpm test src/core/server/daemon-client.test.ts src/modules/harness-parity/daemon-client.test.ts src/modules/harness-parity/model-matrix.test.ts src/modules/harness-parity/model-matrix-eval.test.ts src/modules/eval-harness/subprocess-executor-host-run.test.ts`.
- `pnpm exec biome check src/core/server/daemon-client-test-stubs.ts src/core/server/daemon-client.test.ts` and `pnpm typecheck` passed.
