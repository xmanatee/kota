---
id: task-audit-session-recoverability-against-managed-agents-pattern
title: Audit session recoverability against managed-agents decoupling pattern
status: done
priority: p3
area: daemon
summary: Anthropic's managed-agents post frames sessions as append-only event logs that survive harness crashes via a stateless wake() path. KOTA has run artifacts, event ring buffer, and workflow recovery, but session state lives in daemon memory. Audit what survives a daemon crash mid-turn and close the gaps where live state cannot be reconstructed.
created_at: 2026-04-20T00:30:00.000Z
updated_at: 2026-04-20T01:55:17.443Z
---

## Problem

Anthropic's "Scaling Managed Agents: Decoupling the brain from the
hands" post argues sessions should be durable append-only event logs
that survive harness crashes; a stateless `wake(sessionId)` path
resurrects the agent loop from the log. The goal is that neither
container failure nor harness crash loses the session.

KOTA already has several pieces of this shape: workflow runs land as
append-only artifacts under `.kota/runs/`, the event ring buffer
captures a recent history, and the workflow runtime restarts cleanly
on `runtime.recovered`. Interactive sessions, however, live in daemon
memory. It is not obvious today which session state survives a daemon
crash mid-turn and which must be abandoned — operators may silently
lose in-flight conversations during a crash or restart.

## Desired Outcome

- A written audit (or set of focused tests) covering each live
  daemon-owned runtime state surface (sessions, owner-question queue,
  approval queue, push-token store, scheduler, notification gate)
  against a single question: "if the daemon crashes mid-turn, does
  this state reconstruct from append-only artifacts or is it lost?"
- For each surface where state is lost, a concrete follow-up task or
  an explicit decision that loss is acceptable (with reason recorded
  in the relevant AGENTS.md).
- Where write-through to the event bus or a run artifact would close
  the gap cheaply, land it as part of this audit.

## Constraints

- This is an audit task. It does not itself redesign sessions — the
  follow-ups do.
- Do not add a second event store; reuse the existing event ring
  buffer and run-artifact paths.
- Respect the daemon-core boundary: the audit's recommendations must
  fit the current ownership split, not push runtime state into
  modules.
- Do not introduce session-state write-through on every event if a
  coarser checkpoint would preserve the wake-path guarantee.

## Done When

- The audit exists (a short note under `src/core/daemon/` or as a run
  artifact referenced from `src/core/daemon/AGENTS.md`) covering each
  live runtime-state surface with a recoverability verdict.
- Gaps either have a cheap fix landed in the same PR or a concrete
  follow-up task opened in `data/tasks/backlog/`.
- Deliberate losses (where recovery is judged not worth the cost) are
  recorded in the relevant AGENTS.md with the reason.
