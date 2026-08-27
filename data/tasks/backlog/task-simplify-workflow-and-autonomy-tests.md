---
id: task-simplify-workflow-and-autonomy-tests
title: Simplify workflow and autonomy behavior tests
status: backlog
priority: p1
area: autonomy
summary: Extract small queue, review, disposition, resource, and publication owners so autonomy tests observe decisions and outcomes rather than private workflow phases and production-shaped fixtures.
task_class: Meta
depends_on: [task-align-verification-ownership-and-cadences, task-centralize-approval-and-owner-decision-state]
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-26T23:54:21.238Z
---
## Problem

Autonomy and core workflow suites repeatedly rebuild runtimes, run stores, task queues, agent outputs, prompts, phases, command calls, evidence packets, and histories. Workflow tests often pin step identifiers, helper order, prompt strings, source-specific fixtures, and internal call counts while core runtime behavior is retested by each automation.

## Desired Outcome

Core workflow tests own runtime lifecycle, admission, resources, waiting, integration, recovery, and publication. Autonomy modules expose small decision functions or state machines for queue selection, review projection, disposition, and issue lifecycle. Workflow-level checks retain semantic routing, declared resource ownership, authorization, and published outcomes only.

## Constraints

- Do not create a shadow workflow runtime or universal mega-fixture to make existing tests shorter.
- Treat prompt quality as an agent evaluation when exact wording is the concern; deterministic checks own output schemas and safety boundaries.
- Remove private phase, step-order, command-call, source-absence, and evidence-filename assertions unless externally observable.
- Correct automation prompts and reviewer incentives that reward test volume, artifact count, or implementation preservation.

## How We Will Know

- Private workflow refactors do not require test rewrites when routing, resources, authorization, and published outcomes stay the same.
- Core lifecycle failures are proved once and not copied into every autonomy workflow.
- Agent-language quality lives in a small intentional eval portfolio rather than literal prompt assertions.
- Autonomy and workflow test LOC falls materially within the non-additive 35k-45k opportunity band without weakening recovery or integration evidence.
