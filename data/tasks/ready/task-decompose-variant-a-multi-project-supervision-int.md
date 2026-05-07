---
id: task-decompose-variant-a-multi-project-supervision-int
title: Decompose Variant A multi-project supervision into implementation slices
status: ready
priority: p2
area: architecture
summary: Turn the resolved Variant A multi-project supervision decision into a small set of concrete daemon, CLI, web, and native follow-up tasks so the unblocked parent does not return to the queue as one oversized implementation block.
created_at: 2026-05-07T12:27:35.000Z
updated_at: 2026-05-07T12:27:35.000Z
---

## Problem

`task-surface-project-selection-in-operator-clients-for-` is no longer blocked:
the runtime shape is resolved to Variant A, where one daemon hosts
project-scoped runtimes. The parent task is still too broad for a clean builder
run because it spans daemon runtime ownership, control API shape, CLI views, web
views, and native/mobile parity. If the queue pulls it as one implementation
task, work will either get oversized or leave client follow-ups implicit.

## Desired Outcome

The parent task is decomposed into concrete follow-up tasks that preserve the
Variant A decision and separate the implementation into coherent slices:
daemon project registry/runtime attribution, control API contract, CLI
project-scoped views, web project selector/views, and native/mobile catch-up.
Each follow-up has clear ownership, acceptance evidence, and sequencing.

## Constraints

- Do not re-open the Variant A/B/Hybrid decision.
- Do not implement the multi-project runtime in this task; this is queue
  shaping and decomposition.
- Keep one daemon-owned registry/control protocol. Do not create a client-side
  multi-daemon facade or a hybrid active-project switch.
- Preserve the parent task as the strategic backlog anchor and link follow-ups
  back to it.
- Do not create duplicate client tasks for Apple/iOS and React Native/mobile;
  respect `clients/AGENTS.md` platform ownership.

## Done When

- The parent backlog task has a concise decomposition/status section naming the
  follow-up task ids and intended sequence.
- Follow-up tasks exist for the daemon foundation and the first two operator
  surfaces needed to prove the model (CLI and web).
- Native Apple and React Native/mobile parity is either represented as
  sequenced follow-up work or explicitly deferred behind the shared daemon
  contract.
- The ready/backlog queue remains valid and contains no stale blocked
  owner-decision task for `multi-project-runtime-shape`.

## Source / Intent

The owner asked to address long-blocked tasks instead of letting them stay
blocked forever. The multi-project client selector had a timed-out
owner-decision blocker even though the task itself and architecture standards
already recommended Variant A. This task keeps the unblocked work actionable
without throwing the whole multi-surface implementation into one builder run.

## Initiative

Multi-project operator supervision: one daemon hosts project-scoped runtimes
and every operator client sees project identity through the same daemon control
contract.

## Acceptance Evidence

- The new follow-up task files and the updated parent decomposition section.
- A queue validation report showing no blocked stale decision for
  `multi-project-runtime-shape` and at least one actionable ready task.
