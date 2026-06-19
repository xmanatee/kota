---
id: task-security-review-due-payload-targeting
title: security-review due payload targeting
status: done
priority: p1
area: autonomy
task_class: Safety
summary: Measure and close gaps between security-review due payload paths and scanned candidates.
created_at: 2026-06-19T16:16:13.130Z
updated_at: 2026-06-19T23:50:08.280Z
---

## Problem

`autonomy.security-review.due` carries changed surfaces and paths, but the security-review scan currently appears to build candidates from full-tree discovery with caps. The false-negative rate is unknown: due payload paths may or may not land in `security-review-candidates.json`, and misses are not explained.

## Desired Outcome

Security-review artifacts explicitly report whether each due payload path or surface was represented in `security-review-candidates.json`. If the mismatch is real, due paths and surfaces are prioritized before full-tree candidates while preserving caps. Unscannable due targets are explained with precise miss reasons.

## Constraints

- Measure the mismatch before changing scanner behavior; do not assume a false-negative rate.
- Keep existing scan caps and skip rules unless the diagnostic proves they need a targeted adjustment.
- Do not turn due targeting into an uncapped full-tree scan.
- Miss reasons must be machine-readable enough for later assessment: skipped directory, unsupported extension, too large, no matcher, or an equally explicit existing category.

## Done When

- `security-review-candidates.json` includes due-target match and miss diagnostics.
- Due payload paths and surfaces are inspected before lower-priority full-tree candidates, or the artifact explains why a due target was not scannable.
- Candidate caps still apply after due-priority ordering.
- A static/log-only assessment can quantify matched due targets, missed due targets, and miss reasons for recent runs.

## Source / Intent

Owner follow-up on 2026-06-19: understand what security-review is skipping and why, without inventing assumptions. Known unknown: the exact security-review false-negative rate is not proven yet, so the task must measure before changing behavior.

## Initiative

Autonomy safety-review reliability.

## Acceptance Evidence

- Include a recent-run artifact or fixture showing due-target matched and missed entries.
- Include the static query used to prove due targets are prioritized before full-tree candidates.
- Include at least one explicit unscannable miss reason in fixture or runtime evidence, or state that no miss was observed in the measured sample.

## Completion Evidence

- Prior artifact measurement: `.kota/runs/2026-06-19T15-01-23-246Z-security-review-bmgpb3/security-review-candidates.json` had `hasDueTargets: false` before this change, confirming the gap was real.
- Fixture evidence: `src/modules/autonomy/workflows/security-review/workflow.test.ts` covers matched due targets, `no-matcher`, `skipped-directory`, and `candidate-cap` miss reasons, plus a due-triggered workflow artifact containing `dueTargets`.
- Static query: `rg -n "securityReviewDueTargetsFromPayload|boundCandidatesByPriority|dueTargets: trigger.event|candidate-cap|skipped-directory|no-matcher" src/modules/autonomy/workflows/security-review/security-review.ts src/modules/autonomy/workflows/security-review/workflow.ts src/modules/autonomy/workflows/security-review/workflow.test.ts`.
- Validation: `pnpm test src/modules/autonomy/workflows/security-review/workflow.test.ts`, `pnpm exec biome check src/modules/autonomy/workflows/security-review/security-review.ts src/modules/autonomy/workflows/security-review/workflow.ts src/modules/autonomy/workflows/security-review/workflow.test.ts`, and `pnpm typecheck` pass.
