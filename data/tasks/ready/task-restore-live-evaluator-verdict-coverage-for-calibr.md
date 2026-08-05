---
id: task-restore-live-evaluator-verdict-coverage-for-calibr
title: Restore live evaluator-verdict coverage for calibration monitoring
status: ready
priority: p2
area: autonomy
task_class: Meta
summary: Trace why builder and critic outcomes produce only absent evaluator-calibration verdicts, then restore fail-safe verdict ingestion so the monitor can detect pass contradictions and warning follow-up drift.
created_at: 2026-08-05T16:00:06.845Z
updated_at: 2026-08-05T16:00:06.845Z
---

## Problem

    Trace why builder and critic outcomes produce only absent evaluator-calibration verdicts, then restore fail-safe verdict ingestion so the monitor can detect pass contradictions and warning follow-up drift.

## Desired Outcome

Resolve the progress-review finding from run 2026-08-05T14-47-27-900Z-progress-reviewer-ajw246.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-08-05T14-47-27-900Z-progress-reviewer-ajw246.

review verdict: needs-steering
review summary:

    Directory scope 8nrg1m (kota), run-count review covering 2026-08-04T15:57:10.423Z through 2026-08-05T15:57:10.423Z. Included 20 runs, 20 tasks, 30 events, 40 artifacts, 60 git references, and 170 evidence references; no open dead letters, owner questions, approvals, or operator-journey risks were reported. Excluded 101 policy-pruned run payloads plus truncated run, task, event, artifact, changed-file, git, and lower-detail evidence. Task balance was Safety 12, Meta 8, Product 0, and Platform 0. Native-harness security remediation advanced, but evaluator calibration remains blind because every sampled verdict is absent. Applied action: propose one non-duplicate P2 Meta follow-up; no owner question is needed.

Evidence ids:

- run:2026-08-05T14-10-07-264Z-evaluator-calibration-monitor-hsmk9v
- artifact:2026-08-05T14-10-07-264Z-evaluator-calibration-monitor-hsmk9v:steps/evaluate-calibration.json
- run:2026-08-05T14-47-25-265Z-evaluator-calibration-monitor-e0rmca

## Product / Safety Link

This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- Review-provided acceptance evidence:

    Focused tests cover critic-verdict extraction and missing-verdict handling; a live or replayed builder run writes a non-absent evaluator-calibration verdict, and the following monitor artifact reports nonzero pass, pass_with_warnings, or fail samples with the expected drift decision.
