---
id: task-scope-improver-evidence-gated-triggers
title: scope-improver evidence-gated triggers
status: done
priority: p2
area: autonomy
task_class: Meta
summary: Gate scope-improver wakeups on weighted evidence instead of raw file churn.
created_at: 2026-06-19T16:16:20.409Z
updated_at: 2026-06-20T00:27:48.284Z
---

## Problem

The previous scope-improver fix reduced actions and attention, not wakeups. A broad raw file watch still creates repeated run directories for ordinary churn, so the workflow can run too often before enough evidence exists for useful global system-improvement analysis.

## Desired Outcome

Scope-improver wakes on a semantic `autonomy.scope-improvement.evidence-ready` trigger instead of broad raw file churn. The trigger carries evidence ids, weights, source references, a reason, and a dedupe signature. Task-only and file-only churn has zero weight; failed runs, DLQs, recovery, repeated warnings, and touched oversized files provide meaningful evidence.

## Constraints

- Do not gate solely on commit count, time, or raw file count; evidence readiness must reflect useful signals.
- Preserve intentional/manual scope-improver entry points if they exist.
- Store recent evidence signatures or a bounded window so repeated no-op churn does not create run dirs.
- Keep the evidence model simple enough for static/log inspection.

## Done When

- The broad raw file watch no longer triggers scope-improver directly.
- `autonomy.scope-improvement.evidence-ready` is defined and documented with ids, weights, source references, reason, and dedupe signature.
- Repeated task-only or file-only churn creates zero scope-improver runs in a simple local probe or log replay.
- Failed runs, DLQs, recovery, repeated warnings, and touched oversized files can each contribute nonzero evidence.

## Product / Safety Link

Scope-improver churn crowds out Product and Safety repair work and hides the security-review evidence the owner asked to investigate. Evidence-gated wakeups make global improvement work happen when there is enough signal to improve safety/reliability, not on ordinary queue or file noise.

## Source / Intent

Owner follow-up on 2026-06-19: the scope-improver observation was correct, but the fix must be careful. It should trigger only after enough evidence has accumulated for global analysis, not from simple commit/time/file counting.

## Initiative

Autonomy workflow signal quality.

## Acceptance Evidence

- Include a static query or small replay showing raw file churn creates zero scope-improver runs.
- Include an artifact showing an evidence-ready trigger with ids, weights, source references, reason, and dedupe signature.
- Include a replay or fixture proving duplicate signatures do not create repeated run directories.
