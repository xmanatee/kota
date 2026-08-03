---
id: task-honor-restrictive-scope-policy-revisions-during-ac
title: Honor restrictive scope-policy revisions during active workflow steps
status: ready
priority: p1
area: security
task_class: Safety
summary: Integrate active workflow execution with the scope-policy authority so a step cannot continue relying on a stale authorization snapshot after a restrictive mutation.
depends_on: [task-implement-the-revisioned-observable-scope-policy-a]
created_at: 2026-08-03T15:31:42.493Z
updated_at: 2026-08-03T15:31:42.493Z
---

## Problem

    Publishing revisions alone does not close the original finding if an already-running agent step continues using the policy snapshot resolved at startup.

## Desired Outcome

    The workflow execution boundary retains the authority revision it started with, observes restrictive revisions for the lifetime of the step, and routes them through the existing safe interruption or authorization-failure path before further privileged activity can rely on stale policy.

## Constraints

- Consume the canonical authority rather than adding polling, a second policy cache, or workflow-local mutation state.
- Only restrictive revisions trigger stale-authority handling; equal or purely permissive changes must not silently expand the running step's authority.
- Preserve all approval, tool-risk, secret-handling, injection-defense, and autonomy checks.
- Clean up subscriptions on success, failure, cancellation, timeout, and retry.
- Keep runtime behavior deterministic and reconstructible through existing execution artifacts or events.

## Done When

- Agent-step execution captures the atomic policy-and-revision snapshot from the authority.
- A restrictive mutation during an active step is detected and prevents subsequent privileged actions from relying on the stale snapshot.
- Purely permissive and equal transitions do not widen the active step's effective permissions or cause a false restrictive failure.
- Subscriptions are released on every terminal execution path.
- Focused runtime tests mutate policy during an active step and prove restrictive detection, non-widening behavior, and cleanup.
- The focused verification command and passing result are recorded in the task.

## Source / Intent

    Consumer-integration seam required to close confirmed finding active-workflow-scope-policy-snapshot from security-review run 2026-08-02T12-54-03-665Z; the cited run-executor path currently resolves policy only once for an agent step.

Decomposed from `task-add-revisioned-observable-scope-policy-authority` after builder run `2026-08-03T14-32-25-880Z-builder-1yp7jy` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- A focused runtime test showing an in-flight restrictive revision is observed before further privileged execution.
- Tests proving permissive revisions do not widen the active step and all terminal paths unsubscribe.
- A recorded passing verification command covering the authority-to-workflow integration.
