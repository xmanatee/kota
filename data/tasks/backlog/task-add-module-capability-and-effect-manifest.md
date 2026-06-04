---
id: task-add-module-capability-and-effect-manifest
title: Add module capability and effect manifest
status: backlog
priority: p1
area: modules
summary: Let modules declare capabilities, effects, data classes, setup requirements, event producers, routes, tools, and external side effects in one manifest that guardrails, clients, simulation, and audits can consume.
depends_on: [task-add-module-setup-and-auth-requirement-protocol]
created_at: 2026-06-03T15:51:01.022Z
updated_at: 2026-06-03T15:51:01.022Z
---

## Problem

`KotaModule` already exposes many contribution arrays and factories: tools,
commands, routes, control routes, workflows, channels, skills, agents, events,
config, clients, health checks, and lifecycle hooks. Tool definitions also
carry effect descriptors. But there is no single module-level manifest that
lets the daemon, clients, simulations, progress reviewers, and audits answer:
what can this module do, what data does it touch, what external effects can it
produce, what setup does it require, and what events/routes/tools/channels are
involved?

This makes module behavior harder to inspect and makes UI/setup/simulation
features depend on scattered module internals.

## Desired Outcome

Add a module capability and effect manifest. A module should declare a
machine-readable summary of its capabilities and effects without moving
provider-specific code into core.

The manifest should include:

- Capability ids, descriptions, owning module, and scope policy hooks.
- Setup/auth requirements and current availability links.
- Contributed event producers/consumers, tools, routes, workflows, channels,
  agents, and clients.
- Effect classification for external writes, local writes, daemon mutations,
  network reads, notifications, and owner-visible changes.
- Data classes touched by the module and required redaction/retention posture.
- Simulation/dry-run support level and blocked side-effect reasons.
- Health/readiness summary and dependency modules.

## Constraints

- Do not duplicate the source of truth for individual contributions. The
  manifest should summarize and connect existing declarations.
- Do not put secret values or provider credentials in the manifest.
- Keep provider-specific behavior module-owned. Core validates the manifest
  shape and uses it for guardrails, clients, and simulation.
- Do not create a second tool effect model. Reuse or extend
  `#core/tools/effect.js`.
- Manifest omissions should fail validation for modules that declare external
  side effects.

## Done When

- `KotaModule` supports a strict manifest contribution or derived manifest
  builder with runtime validation.
- Module summaries and daemon APIs expose capability/effect information.
- Guardrails, setup/auth status, simulation/trial mode, and explain graph can
  consume the same manifest data.
- Telegram, Google Workspace, Slack, browser/web access, and one model-client
  module provide manifest coverage.
- Tests cover missing required effect metadata, manifest projection, secret
  redaction, readiness state, and simulation side-effect blocking.

## Source / Intent

Owner values on 2026-06-03: simple clear contracts, separation of concerns, no
duplicated mechanisms, and protocolized auth/setup/channel behavior. Local
investigation found `src/core/modules/module-types.ts` has many contribution
surfaces but no consolidated capability/effect manifest. Tool effects exist,
but the module-level view is not queryable.

Relevant local code:

- `src/core/modules/module-types.ts`
- `src/core/tools/effect.ts`
- `src/core/tools/tool-runner.ts`
- `src/modules/telegram/index.ts`
- `src/modules/google-workspace/index.ts`
- `src/modules/slack-channel/index.ts`

Research references:

- AsyncAPI uses message/channel/operation contracts for event-driven APIs:
  `https://www.asyncapi.com/docs/reference/specification/v3.0.0`
- OWASP logging guidance emphasizes data classification and excluding sensitive
  data from logs: `https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html`

## Initiative

Inspectable modules: clients, guardrails, simulations, and reviewers can reason
about module capabilities through one protocol-shaped manifest.

## Acceptance Evidence

- Typecheck and unit tests for manifest validation and projection.
- Daemon API fixture showing manifests for Telegram and Google Workspace with
  setup status, capabilities, effects, data classes, and redacted fields.
- Simulation/trial fixture proving an external side effect is blocked using the
  manifest rather than module-specific code.
