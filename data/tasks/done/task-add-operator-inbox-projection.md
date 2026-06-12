---
id: task-add-operator-inbox-projection
title: Add operator inbox projection
status: done
priority: p1
area: client
summary: Expose one operator inbox for approvals, owner questions, blocked tasks, setup gaps, failed runs, and runtime warnings.
created_at: 2026-06-11T22:23:59.976Z
updated_at: 2026-06-11T22:23:59.976Z
task_class: Product
---

## Problem

The owner had no single place to see what KOTA needed from them. Approvals,
owner questions, blocked tasks, setup gaps, failed runs, and daemon/runtime
warnings lived behind separate commands or files, so blocked work could be
valid in the queue while practically invisible.

## Desired Outcome

Add a first operator inbox projection and CLI command that aggregates the
current attention sources through `KotaClient` and renders direct next actions.

## Constraints

- Use existing namespaces; do not add a parallel store.
- Work daemon-up and daemon-down through the current client selector.
- Keep secrets out of output.
- This is the first projection, not the final shared UI protocol.

## Done When

- `kota inbox` renders pending approvals, owner questions, blocked tasks,
  setup gaps, failed/interrupted runs, and runtime warnings.
- `kota inbox --json` emits the same structured projection.
- The command exits non-zero only for active owner-response blockers
  (approvals or owner questions).
- Focused tests cover clear and populated inbox fixtures.

## Source / Intent

Owner request on 2026-06-11: blocked tasks and required owner actions are not
obvious, and the system is not built from a human UX perspective.

## Initiative

KOTA trustworthy control plane.

## Acceptance Evidence

- `pnpm test src/modules/daemon-ops/operator-inbox.test.ts` covers a full inbox
  fixture with approval, owner question, blocked task, setup gap, failed run,
  and runtime warning.
- `pnpm kota inbox --json` emits a structured projection in the local repo.
