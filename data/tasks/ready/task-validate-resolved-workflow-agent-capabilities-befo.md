---
id: task-validate-resolved-workflow-agent-capabilities-befo
title: Validate resolved workflow agent capabilities before dispatch
status: ready
priority: p0
area: core
task_class: Platform
summary: Reject statically impossible workflow and agent-harness contracts at definition load using the canonical run-option resolver.
created_at: 2026-08-06T20:21:41.180Z
updated_at: 2026-08-06T20:21:41.180Z
---

## Problem

Workflow definition validation resolves an agent step's harness, model, autonomy
mode, tool policy, and harness options, but it does not validate the resulting
run contract against the selected adapter's declared unsupported options.
`assertAdapterCanHostRequestedCapabilities` performs that check only immediately
before launch. A statically impossible definition can therefore load, queue,
claim capacity, create a run directory, and enter the DLQ before reporting a
configuration error.

This happened when `progress-reviewer` requested passive autonomy from the Codex
native harness. Commit `532ab1ae` changed that one workflow to autonomous mode,
which repairs the symptom but leaves every workflow exposed to the same late
failure class.

## Desired Outcome

Validate the fully resolved, static agent run contract while workflow
definitions are loaded or reloaded. An incompatible workflow/preset/harness
combination must be rejected with workflow, step, harness, option, and reason
before it can be queued. Runtime launch must use the same resolution and
capability assertion, so definition validation and execution cannot disagree.

## Constraints

- Reuse the canonical run-option resolution and
  `assertAdapterCanHostRequestedCapabilities`; do not add another harness
  capability table or a validator-only approximation of runtime options.
- Validate the effective contract after workflow defaults, registered
  `AgentDef`, model-tier presets, autonomy mode, tool policy, owner-question
  access, persistence, thinking, and harness options have been resolved.
- Cover every definition shape that can launch an agent, including grouped
  child steps and repair-loop agent/judge paths. A nested path must be named in
  the definition error.
- Reject only static semantic incompatibility at definition load. Authentication,
  provider reachability, rate limits, and other changeable readiness remain
  runtime state and must not make definitions permanently invalid.
- Remove the late-only validation path or make it call the same pure contract
  validator as a final invariant. Do not retain two behavioral implementations.
- Keep the broader single-capability initiative
  `task-make-capability-mechanisms-single-source-across-ko` intact. This task
  enforces already-declared agent-harness capabilities; it does not create a
  second capability registry.

## Done When

- A passive Codex agent step fails workflow validation and daemon definition
  load/reload before queue insertion, run creation, agent launch, or DLQ write.
- Every active workflow definition validates against its resolved harness
  contract, including presets and nested agent execution paths.
- Definition validation and runtime launch call one shared run-contract
  resolver/assertion and produce consistent incompatibility diagnostics.
- Dynamic harness readiness can recover without changing or reloading a valid
  definition.
- The focused validation fixtures cover an unsupported autonomy mode, an
  unsupported run option, a supported native contract, and a nested agent path.

## Source / Intent

Deep autonomy productivity audit on 2026-08-06. Four recent
`progress-reviewer` DLQs came from a static passive-Codex incompatibility that
was discoverable before dispatch. The owner asked for root-cause repairs that
make automation more productive without adding cooldowns, fallback behavior,
or duplicated guardrails. Early validation prevents known-impossible work from
consuming cycles while preserving AI judgment for semantic decisions.

## Initiative

One resolved agent execution contract from definition through launch.

## Acceptance Evidence

- A focused validation transcript shows the incompatible passive-Codex fixture
  rejected with its exact workflow and step path.
- A queue/run/DLQ fixture proves that rejected definitions create none of those
  records.
- A contract-parity fixture executes a supported definition and proves the
  validator and launcher consume the same resolved options.
