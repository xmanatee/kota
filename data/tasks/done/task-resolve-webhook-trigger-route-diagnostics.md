---
id: task-resolve-webhook-trigger-route-diagnostics
title: Resolve webhook trigger route diagnostics
status: done
priority: p3
area: webhook
task_class: Product
summary: Recent webhook Safety fixes landed, but builder diagnostics now leave webhook trigger route and route/CLI test source-size advisories plus a prior observability-obligation warning on the same runtime-sensitive surface. Split cohesive route/test helpers or record narrow justified exceptions, and add or recheck inspectable observability evidence without weakening signature verification or sensitive-header filtering.
created_at: 2026-07-06T17:22:18.945Z
updated_at: 2026-07-06T17:34:04.325Z
---

## Problem

    Recent webhook Safety fixes landed, but builder diagnostics now leave webhook trigger route and route/CLI test source-size advisories plus a prior observability-obligation warning on the same runtime-sensitive surface. Split cohesive route/test helpers or record narrow justified exceptions, and add or recheck inspectable observability evidence without weakening signature verification or sensitive-header filtering.

## Desired Outcome

Resolve the progress-review finding from run 2026-07-06T17-09-36-812Z-progress-reviewer-55t4az.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-07-06T17-09-36-812Z-progress-reviewer-55t4az.

review verdict: needs-steering
review summary:

    Scope 8nrg1m/kota run-count review for 2026-07-05T17:17:20.492Z to 2026-07-06T17:17:20.492Z included 20 runs, 13 tasks, 24 events, 40 artifacts, and 60 git refs with retention/truncation exclusions. Balance is Safety 3, Product 2, Platform 1, Meta 7. Safety/Product outcomes are healthy and there are no owner questions, open dead letters, or operator-journey risks, but webhook post-fix diagnostics need one narrow follow-up.

Evidence ids:

- artifact:2026-07-06T16-40-48-938Z-builder-76uy8z:source-file-size-review.json
- artifact:2026-07-06T16-40-48-938Z-builder-76uy8z:observability-obligation-review.json
- run:2026-07-06T16-40-48-938Z-builder-qlezje
- git:commit:68dd2c911562

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    A follow-up run artifact or diagnostic recheck shows webhook route and test source-size advisories resolved or covered by narrow typed exceptions, maps trigger-route.ts to focused test/explicit rationale observability evidence with no unresolved missing files, and records passing focused webhook route/CLI tests plus task validation.

## Resolution Evidence

- Split the oversized webhook trigger route and route/CLI test surfaces into focused module-owned helpers and suites. Touched webhook source/test files are now below the 300-line source-size guideline.
- `.kota/runs/2026-07-06T17-09-57-782Z-builder-3f2n9j/source-file-size-review.json` records outcome `ok`, `warnings: []`, and `OK: changed source files are under source-size warning thresholds`.
- `.kota/runs/2026-07-06T17-09-57-782Z-builder-3f2n9j/observability-obligation-review.json` records outcome `ok`, maps `src/modules/webhook/trigger-route.ts` and extracted webhook helpers to focused test assertions, and has `missingFiles: []`.
- `.kota/runs/2026-07-06T17-09-57-782Z-builder-3f2n9j/transcript.txt` records an operator-route transcript for a signed `/webhooks/deploy` delivery, sensitive-header filtering in the forwarded workflow payload, and a tampered-signature `401` response.
- Validation passed: `pnpm test src/modules/webhook/trigger-route.test.ts src/modules/webhook/trigger-route-security.test.ts src/modules/webhook/cli.test.ts`, `pnpm typecheck`, and `pnpm validate-tasks`.
