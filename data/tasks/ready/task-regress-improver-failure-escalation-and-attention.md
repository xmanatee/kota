---
id: task-regress-improver-failure-escalation-and-attention
title: Regress improver failure escalation and attention reporting
status: ready
priority: p1
area: autonomy
task_class: Meta
summary: Anchor detector and operator-facing behavior to the repaired improver semantics using fresh synthetic run evidence.
depends_on: [task-repair-improver-commit-message-artifact-lifecycle]
created_at: 2026-08-03T14:21:53.396Z
updated_at: 2026-08-03T14:21:53.396Z
---

## Problem

    Repairing improver alone does not prove that fresh artifacts stop workflow-failure:consecutive-failures:improver:step-error:9dc32dfa2618 from crossing the escalation gate, nor that a genuine future local recurrence remains detectable and produces operator attention containing the generated task id without cost fields.

## Desired Outcome

    The failure escalator distinguishes repaired fresh improver outcomes from genuine consecutive local step failures, remains idempotent by stable root-cause fingerprint, and emits operator attention with the generated task id and no cost or throughput data.

## Constraints

- Build fixtures from fresh run metadata matching the repaired semantics rather than rewriting or deleting historical evidence.
- Preserve provider, authentication, rate-limit, classified infrastructure, and agent-step timeout exclusions.
- Keep one canonical repair task per stable root-cause fingerprint; do not create one task per failed run.
- Do not suppress genuine local commit-artifact failures or broaden exclusions without committed evidence.
- Keep cost and throughput fields absent from attention events, digest fixtures, and autonomy-agent context.

## Done When

- Detector tests show fresh repaired improver artifacts no longer satisfy the cited consecutive-failure fingerprint.
- A control fixture with the configured threshold of equivalent future local failures still crosses the gate and creates or reuses exactly one task anchored to the stable root-cause fingerprint.
- A success or otherwise repaired terminal result correctly breaks the consecutive-failure sequence.
- Attention-event or digest tests assert that future escalations name the generated task id and contain no cost or throughput fields.
- Focused escalator, idempotency, and attention-reporting tests pass.

## Source / Intent

    Retain evidence-backed escalation for real recurring local failures while proving the repaired improver behavior clears the current pattern and operator reporting remains safe and actionable.

Decomposed from `task-repair-workflow-failure-pattern-d4f42f3e7dbc` after builder run `2026-08-03T13-20-05-894Z-builder-ceqy9p` exhausted repair.

## Product / Safety Link

This recovery task unblocks the Product or Safety intent preserved by `task-repair-workflow-failure-pattern-d4f42f3e7dbc`.

## Initiative

    Autonomy fleet health: recurring local workflow failures should graduate into deterministic, reviewable repair work.

## Acceptance Evidence

- Detector test output covering repaired fresh artifacts, sequence reset, recurrence threshold, and idempotent task reuse.
- A synthetic run-artifact fixture demonstrating that the current fingerprint no longer crosses after the repair.
- An attention-event fixture or operator transcript naming the generated task id and showing no cost or throughput fields.
