---
id: task-resolve-model-matrix-builder-monitor-warnings
title: Resolve model-matrix builder monitor warnings
status: ready
priority: p2
area: core
summary: Add or justify observability evidence for the daemon-client test stub change from the model-matrix builder run, and handle the touched source-size advisories so future builder diagnostics do not leave the same warnings untracked.
created_at: 2026-06-27T02:39:27.837Z
updated_at: 2026-06-27T02:39:27.837Z
---

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

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A task note or run artifact shows observability-obligation diagnostics no longer report src/core/server/daemon-client-test-stubs.ts as missing, or records a narrow accepted rationale; source-size diagnostics no longer warn for the touched files or record typed exceptions; focused harness-parity/eval-harness validation passes.
