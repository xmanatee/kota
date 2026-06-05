---
id: task-add-named-agent-handoff-protocol
title: Add named agent handoff protocol
status: done
priority: p1
area: core
summary: Add a typed named-agent handoff protocol that lets agents and workflow steps delegate to registered agents with explicit inputs, scope, budgets, tool policy, trace links, and resume semantics.
depends_on: [task-promote-projects-into-hierarchical-scopes]
created_at: 2026-06-03T15:50:46.186Z
updated_at: 2026-06-04T23:15:13Z
---

## Problem

KOTA has registered `AgentDef`s and a generic `delegate` tool. It also allows
workflow agent steps to carry `agentName`, but the workflow executor still
stores concrete prompt/model/harness configuration and the current `delegate`
tool creates generic sub-agents by mode rather than handing work to a named
registered agent with an explicit contract.

The owner asked whether agents can spawn or delegate to other agents when
necessary. Today the answer is partially yes, but not as a first-class,
named-agent protocol with scope, budgets, trace links, and resumable handoff
semantics.

## Desired Outcome

Add a named-agent handoff protocol. A workflow step or running agent can hand
work to a registered agent by name, with typed input, expected output schema,
scope, autonomy posture, budget/depth limits, allowed tools, write boundaries,
handoff reason, and trace/causation links.

The protocol should support:

- "Agent as tool" style delegation where the original agent stays in control.
- "Transfer" style handoff where a specialist owns the next segment and returns
  a structured result or resumes a session.
- Workflow step resolution from `agentName` through the global/module agent
  registry.
- Child run/session identity linked to parent event/run/span.
- Budget and recursion limits aligned with existing delegate budget controls.

## Constraints

- Do not create a second agent registry. Reuse `AgentDef` and module-contributed
  agents.
- Do not let named handoff bypass tool policy, write scope, owner approvals, or
  autonomy mode constraints.
- Do not force all delegation through natural-language prompts. Handoff inputs
  and outputs need typed schemas where the caller requires structure.
- Keep generic `delegate` useful for exploration/research, but make named
  specialist handoff the explicit protocol when a known agent should own work.
- Preserve traceability: parent and child sessions/runs must be queryable from
  each other.

## Done When

- A typed handoff request/result protocol exists with named agent, input schema,
  output schema, scope, budget, tool policy, and parent trace/run/session ids.
- Workflow agent steps can resolve `agentName` from registered agents rather
  than copying prompt/model fields everywhere.
- The delegate tool or a sibling tool can dispatch to named agents with the
  same budget/depth guardrails.
- Tests cover registry resolution, missing agent rejection, scope/write-policy
  enforcement, parent/child trace linkage, recursion limit, structured output
  validation, and failure propagation.
- A fixture demonstrates one workflow agent handing a review task to a named
  reviewer agent and consuming the structured result.

## Source / Intent

Owner architecture review question on 2026-06-03: "are agents now able to spawn
other agents or delegate to other agents when necessary?" Local investigation
found:

- `src/core/agents/agent-types.ts` defines registered `AgentDef`.
- `src/core/tools/delegate.ts` supports generic sub-agent delegation by mode.
- `src/core/workflow/step-input-base.ts` notes workflow agent steps do not
  resolve through the global agent catalog.

Research reference: OpenAI Agents SDK represents handoffs as tools for
specialist transfer:
`https://openai.github.io/openai-agents-js/guides/handoffs/`

## Initiative

First-class specialist delegation: agents can collaborate through typed,
auditable handoffs instead of prompt-only delegation.

## Acceptance Evidence

- Unit tests for handoff validation, registered-agent resolution, and guardrail
  enforcement.
- Workflow integration test showing a named child agent run linked to a parent
  workflow run.
- Run artifact showing handoff request, child result, parent consumption, and
  trace/causation ids.
