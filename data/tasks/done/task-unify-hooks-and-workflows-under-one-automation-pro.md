---
id: task-unify-hooks-and-workflows-under-one-automation-pro
title: Unify hooks and workflows under one automation protocol
status: done
priority: p1
area: core
summary: Make KOTA expose one automation protocol where hook-style event reactions, schedules, watches, code steps, agent steps, approvals, and chained runs compile to the existing durable workflow runtime instead of becoming parallel trigger engines.
created_at: 2026-06-03T13:40:09.383Z
updated_at: 2026-06-04T07:57:04Z
---

## Problem

KOTA already has a durable workflow runtime that handles event triggers,
schedule triggers, interval triggers, watch triggers, webhook triggers,
agent/code/tool/approval/await-event steps, trigger chaining, run stores, and
validation. It also has other hook-like mechanisms, including agent harness
pre/post hooks, dynamic prompt state providers, pre-send hooks, cleanup hooks,
and channel subscriptions.

The owner wants a simple concept of hooks while avoiding duplicate mechanisms.
If KOTA adds code hooks, agent hooks, workflows, standing orders, and schedules
as separate trigger engines, the architecture will become harder to verify and
harder for agents to use correctly.

## Desired Outcome

Define one automation protocol with a small user-facing vocabulary:

- A hook is an automation that reacts to a typed event, scheduled tick, watch,
  webhook, or batch and runs ordered steps.
- Code, agent, tool, approval, await-event, emit, parallel, branch, foreach,
  and trigger are step executors, not separate hook kinds.
- A workflow is the durable compiled/runtime representation of an automation.
- Schedules are trigger/event producers, not properties of agents.
- Agent harness hooks remain internal extension points and are named
  separately from operator-authored automations.

The implementation should keep the existing workflow runtime as the execution
engine and add authoring/UI aliases or schema refinements only where they make
the operator model simpler.

## Constraints

- Do not create a parallel hook scheduler, hook run store, hook event bus, or
  hook approval path.
- Do not split code hooks and agent hooks into distinct top-level concepts.
  They are step types with different safety and validation rules.
- Preserve current workflow definitions and validation while making the public
  vocabulary clearer.
- Keep deterministic validation: triggers must declare event names, filters
  must reference declared fields where available, step output schemas must be
  validated, and schedules must keep explicit overlap/cooldown semantics.
- Record how this differs from Temporal's workflow/activity/message model and
  Home Assistant's trigger/condition/action model without copying either
  wholesale.

## Done When

- `docs/ARCHITECTURE.md`, `src/core/workflow/AGENTS.md`, and relevant module
  docs define hook, automation, workflow, trigger, schedule, and step with no
  overlap.
- The workflow schema or a thin authoring adapter can express a hook as an
  event-triggered automation without adding a new runtime engine.
- CLI/client labels can show hooks or automations for operator clarity while
  still using workflow definitions and runs under the daemon API.
- Tests pin that hook-style definitions compile to workflow definitions and
  use the same run store, approvals, event payloads, and concurrency controls.
- Existing workflows continue to run unchanged.

## Source / Intent

Owner request from `data/inbox/many.md` and follow-up answers on 2026-06-03:
"hook is simpler concept than workflow... maybe they both should exist" and
"definitely not both" for code-hooks vs agent-hooks. The intended direction is
minimal concepts with no duplicate trigger mechanisms.

Relevant current code: `src/core/workflow/trigger-types.ts`,
`src/core/workflow/step-types.ts`, `src/core/workflow/runtime.ts`,
`src/core/workflow/schedule-triggers.ts`,
`src/core/workflow/watch-triggers.ts`,
`src/core/agent-harness/hooks.ts`, and `src/core/modules/module-types.ts`.

Research references: Temporal workflows and message passing
(`https://docs.temporal.io/workflows`,
`https://docs.temporal.io/develop/typescript/workflows/message-passing`) and
Home Assistant automations
(`https://www.home-assistant.io/docs/automation/trigger/`).

## Initiative

Single automation surface: KOTA should let users think in hooks when helpful
without paying the maintenance cost of multiple automation engines.

## Acceptance Evidence

- Updated architecture and workflow docs.
- Unit tests proving hook-style authoring compiles to workflow runtime
  definitions.
- `pnpm test` output for workflow validation, schedule triggers, watch
  triggers, and workflow run execution.
