---
id: task-make-native-agent-invalidation-lifecycle-reusable
title: Make native agent invalidation lifecycle reusable for nested launches
status: ready
priority: p1
area: security
task_class: Safety
summary: Provide one canonical lifecycle that links an inherited abort signal and restrictive scope-policy revisions to a child AbortController, with deterministic listener cleanup.
created_at: 2026-08-05T12:37:15.050Z
updated_at: 2026-08-05T12:37:15.050Z
---

## Problem

    The workflow agent-attempt path subscribes native agents to restrictive scope-policy changes, but nested native delegates have no reusable lifecycle that also propagates the parent tool-call AbortSignal. Reimplementing either concern inside delegate-harness would risk divergent policy semantics and leaked listeners.

## Desired Outcome

    A core helper usable by workflow attempts and nested delegates owns a child AbortController, handles already-aborted and later-aborted parent signals, applies the canonical restrictive-policy subscription, and exposes idempotent cleanup without changing existing workflow-attempt behavior.

## Constraints

- Reuse the canonical restrictive-policy comparison and subscription semantics; do not introduce a parallel policy watcher.
- Do not abort on equal or less-restrictive policy revisions.
- Cleanup must remove both parent-abort and scope-policy listeners on success, failure, or abort.
- Preserve existing workflow agent-attempt quarantine behavior and authorization boundaries.

## Done When

- A reusable native invalidation lifecycle composes parent abort propagation with restrictive scope-policy subscription around a child AbortController.
- An already-aborted parent and a parent aborted after launch both abort the child.
- A restrictive policy revision aborts the child while equal or less-restrictive revisions do not.
- Cleanup is idempotent and focused tests prove that neither listener remains registered afterward.
- Existing workflow agent-attempt tests continue to pass using the canonical lifecycle.

## Source / Intent

    Security finding native-delegate-restriction-quarantine-gap from security-review run 2026-08-04T04-04-56-434Z-security-review-0z9fqt; decomposed after builder run 2026-08-05T11-38-20-249Z-builder-qnyrnq exhausted repair.

Decomposed from `task-security-review-a-kota-hosted-parent-can-launch-an` after builder run `2026-08-05T11-38-20-249Z-builder-qnyrnq` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused unit-test transcript covering pre-aborted and later-aborted parent signals, restrictive and non-restrictive policy revisions, and idempotent listener cleanup.
- Focused workflow agent-attempt test transcript showing its existing native quarantine behavior is preserved.
