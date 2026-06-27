---
id: task-add-observability-evidence-for-scaffold-model-matr
title: Add observability evidence for scaffold model-matrix files
status: ready
priority: p2
area: modules
summary: Builder run 2026-06-27T10-17-38-365Z-builder-wmuuo5 completed scaffold weak/local model mode, but its observability diagnostic reports missing evidence for src/modules/harness-parity/model-matrix-contract.ts and src/modules/harness-parity/model-matrix-rows.ts.
created_at: 2026-06-27T12:07:46.266Z
updated_at: 2026-06-27T12:07:46.266Z
---

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
