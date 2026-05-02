---
id: task-add-fan-out-consolidation-reviews-after-multi-clie
title: Add fan-out consolidation reviews after multi-client surface batches
status: done
priority: p2
area: autonomy
summary: Teach the queue-shaping/autonomy process to create a consolidation task after capability fan-out across clients, checking IA, duplication, runtime contracts, screenshots, and cross-client consistency before declaring the surface family healthy.
created_at: 2026-04-28T22:36:11.452Z
updated_at: 2026-05-02T21:03:54.010Z
---

## Problem

Autonomy has developed a productive fan-out cadence: implement a capability in
daemon/CLI/Telegram/web/macOS/mobile/Slack until every surface has parity. That
shipped a lot of functionality, but it also created local-copy bias:

- each macOS task told builders to mirror the previous collapsible section;
- task acceptance focused on per-surface contract branches, not holistic IA;
- screenshots were requested but not enforced;
- no final task asked whether the surface family remained coherent after the
  fan-out.

The result was an overloaded menu bar with many green per-task tests.

## Desired Outcome

The autonomy queue-shaping process creates or promotes a consolidation review
after a multi-client fan-out batch. The consolidation task checks:

- operator information architecture and workflow fit;
- cross-client capability contract consistency;
- duplicated route/error/rendering logic;
- provider readiness and unavailable-state handling;
- live runtime/screenshot/transcript evidence;
- stale legacy affordances that no longer match newer daemon APIs;
- whether docs/AGENTS still describe reality.
- whether prior accepted critic warnings left compatibility shims, text-only
  visual proof, or duplicated client state that should block the consolidation
  from passing.

## Constraints

- Do not block useful fan-out work upfront. The consolidation should happen
  after enough surfaces land to reveal shape problems.
- Prefer a small detector/report or explorer queue-shaping heuristic over a
  prompt-only reminder.
- Avoid creating endless review tasks for tiny one-client changes.
- Connect this to actual task metadata/commit patterns where possible:
  repeated "Telegram -> CLI -> daemon -> web -> macOS -> mobile" surface
  sequences are the target.
- The output should be actionable builder tasks, not only commentary.

## Done When

- Explorer/improver/dispatcher or queue-shaping logic can identify completed
  multi-client fan-out batches and seed a consolidation task.
- The seeded consolidation task template includes IA, runtime contract,
  rendered evidence, docs, accepted-warning review, and cross-client
  consistency checks.
- Tests or fixtures prove the detector does not fire on unrelated single-surface
  tasks and does fire on a representative fan-out sequence.
- Existing autonomy workflow tests remain green.

## Source / Intent

2026-04-28 investigation found a repeated task/commit pattern adding
Knowledge/Memory/History/Tasks/Recall/Answer/Capture/Retract surfaces to macOS
one by one. The tasks optimized for parity and "mirror the previous view" but
no process created a final UX/contract consolidation pass. Owner asked that
future tasks remove the class of issue across clients, modules, core, and the
related mechanisms.

## Initiative

Autonomy quality control: fan-out should end in a coherent product surface, not
just a checklist of parity commits.

## Acceptance Evidence

- Workflow/unit test output for the fan-out detector or seeding logic.
- Example generated consolidation task from a fixture fan-out sequence.
- Updated autonomy guidance naming when consolidation is required and what it
  must inspect.
- A critic/evaluator fixture showing a consolidation task cannot pass with
  only per-surface unit tests when the requested outcome is visual/runtime
  coherence across clients.
