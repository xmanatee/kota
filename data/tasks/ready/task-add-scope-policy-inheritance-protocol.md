---
id: task-add-scope-policy-inheritance-protocol
title: Add scope policy inheritance protocol
status: ready
priority: p1
area: core
summary: Add a focused policy inheritance contract for hierarchical scopes so autonomy, writes, channel routing, setup visibility, retention, and owner-confirmation requirements can be resolved consistently without typed project categories.
depends_on: [task-promote-projects-into-hierarchical-scopes]
created_at: 2026-06-03T15:50:52.628Z
updated_at: 2026-06-05T18:23:08.608Z
---

## Problem

The owner explicitly does not want typed projects in core. KOTA should have
hierarchical scopes, with directories as the initial concrete scope kind. Once
scopes exist, KOTA still needs a disciplined way to resolve policy for a given
scope: autonomy posture, write permissions, allowed channels, event routing,
setup visibility, retention, redaction, owner confirmation, and module
capability availability.

Without one inheritance protocol, each module will likely invent its own
"global vs project vs directory" rules and clients will show inconsistent
availability.

## Desired Outcome

Add a focused scope policy inheritance protocol. A scope can declare policy
fragments, inherit from parent scopes, and produce one resolved policy object
for a runtime action. The resolved policy should be queryable and explainable,
but core should not need to know domain-specific project types.

Policy areas should include:

- Autonomy mode defaults and allowed escalation.
- Agent/tool write boundaries.
- Channel routing eligibility and ignored/blocked sources.
- Setup/auth requirement visibility.
- Owner-confirmation requirements for effects.
- Retention/redaction defaults.
- Module capability enablement and external-effect posture.

## Constraints

- Do not add typed project categories such as trip-planning, birthday-planning,
  codebase, or self-improvement. They are scope content, not core types.
- Keep policy fragments structured and validated. Do not rely on agent prompts
  to remember scope rules.
- Do not duplicate guardrails. Scope policy resolves inputs to existing
  guardrail, tool-effect, workflow, client, setup, and retention mechanisms.
- Make inheritance explicit and explainable. If a child overrides a parent,
  clients should be able to show which rule won.
- Do not allow a child scope to silently widen dangerous capabilities beyond
  parent policy unless the protocol explicitly permits that override.

## Done When

- A typed scope policy model exists with inheritance, validation, and resolved
  policy output.
- Runtime code that needs scope policy can request one resolved object instead
  of reading module-specific config directly.
- Daemon API/client fixtures can show inherited, overridden, and blocked policy
  values for a directory scope.
- Tests cover inheritance, override, forbidden widening, missing policy,
  channel routing decision, owner-confirmation requirement, and retention
  policy resolution.
- Existing project-scoped behavior has a migration path into the new scope
  policy without preserving a parallel "project type" mechanism.

## Source / Intent

Owner follow-up on 2026-06-03: "there shouldn't be a concept of project in
core abstractions, but there probably should be concept of scope" and "every
scope is equal and scopes could be arranged in a hierarchy." The local code
currently has project-scoped event and daemon runtime helpers, so scope policy
needs to follow the scope migration rather than widen the old project concept.

Relevant local code:

- `src/core/events/project-scope.ts`
- `src/core/daemon/scope-registry.ts`
- `src/core/agents/agent-types.ts`
- `src/core/tools/guardrails.ts`
- `src/modules/telegram/AGENTS.md`

Research reference: Open Policy Agent is a general policy engine with a
declarative language for policy over hierarchical data:
`https://www.openpolicyagent.org/docs/`

## Initiative

Scope-first governance: KOTA can express local rules without typed project
categories or module-specific policy forks.

## Acceptance Evidence

- Unit tests for policy inheritance and override validation.
- Daemon API fixture showing resolved policy for nested directory scopes.
- CLI/client rendered fixture showing why a channel event or tool write is
  allowed, blocked, or requires owner confirmation in a given scope.
