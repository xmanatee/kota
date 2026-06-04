---
id: task-publish-kota-architecture-concept-map-and-scenario
title: Publish KOTA architecture concept map and scenario matrix
status: done
priority: p1
area: architecture
summary: Document KOTA's existing and intended concepts, protocols, constraints, and scenario mappings so future implementation work has one verifiable architecture source of truth.
created_at: 2026-06-03T13:39:58.360Z
updated_at: 2026-06-04T17:26:00.000Z
---

## Problem

KOTA has a strong architecture direction in `docs/ARCHITECTURE.md` and scoped
`AGENTS.md` files, but the full concept map is fragmented across docs, code
comments, module contracts, and runtime tests. The owner is asking for clear
definitions of concepts such as events, agents, hooks, schedules, modules,
directories/scopes, prompts, workflows, channels, stores, clients, auth/setup,
and persistence, plus scenario-level proof that the concepts can express real
KOTA use cases without adding duplicate mechanisms.

Without one durable concept map, future work can drift into parallel trigger
engines, over-broad project semantics, channel-specific routing hacks, and
client-specific UI implementations.

## Desired Outcome

Publish a durable architecture document that maps current and intended KOTA
concepts to definitions, protocols, workflows, constraints, and use cases. The
document must explicitly distinguish:

- Core primitives from module-owned contributions.
- Scope from the current project terminology.
- Event payloads, event scope, and event persistence limits.
- Hook-style automations from the existing durable workflow runtime.
- Agents, agent definitions, sessions, harnesses, delegation, and prompts.
- Channels from clients.
- Auth/setup requirements from secrets and persisted owner decisions.
- Shared UI contribution contracts from client-specific rendering.
- Existing agent delegation through the `delegate` tool and workflow trigger
  chaining, including any remaining gaps around named-agent spawning.

The document must include a scenario matrix covering at least: multi-scope
continuous improvement, weekly meta-review, Telegram blocked/archived source
handling, Telegram sports-availability intake with schedule matching,
confirmation-to-booking flows, high-volume event batching with staged model
passes, and progress review by task count or message count.

## Constraints

- Keep the architecture source of truth concise and verifiable. Prefer typed
  contracts and links to source files over long prompt-style instructions.
- Do not introduce a second migration tracker or changelog in `docs/`.
- Capture the conclusion that KOTA should minimize core concepts and compile
  convenience authoring concepts into one runtime mechanism when possible.
- Record known current gaps honestly, including current project terminology,
  the in-memory event ring buffer, Telegram text-only intake, env-var based
  credentials, and the opt-in `kota navigate` CLI.
- Keep research links visible. Relevant references include Temporal workflows
  and message passing (`https://docs.temporal.io/workflows`,
  `https://docs.temporal.io/develop/typescript/workflows/message-passing`),
  Home Assistant automations and config flows
  (`https://www.home-assistant.io/docs/automation/trigger/`,
  `https://developers.home-assistant.io/docs/core/integration/config_flow/`),
  Node-RED message design
  (`https://nodered.org/docs/developing-flows/message-design`), JSON Forms
  architecture (`https://jsonforms.io/docs/architecture/`), Backstage frontend
  plugins/extensions
  (`https://backstage.io/docs/frontend-system/architecture/plugins/`), Ink,
  Bubble Tea, Textual, and MCP elicitation.

## Done When

- `docs/ARCHITECTURE.md` or a linked architecture doc defines every current
  and intended concept needed by the scenario matrix.
- The document names the canonical mechanism for each concept and explicitly
  rejects duplicate mechanisms where they would overlap.
- The scenario matrix shows how each owner scenario is expressed with existing
  concepts today, what is missing, and which normalized task closes the gap.
- Scoped `AGENTS.md` files near touched areas are updated only where a durable
  convention changed.
- The architecture doc links to the relevant source files and research
  references without becoming a task queue.
- `pnpm typecheck` and the task queue validator pass after the doc update.

## Source / Intent

Owner request from `data/inbox/many.md` on 2026-06-03: review KOTA's current
architecture and system design, list all concepts/abstractions, define their
protocols and constraints, test them against diverse scenarios, and turn the
result into normalized KOTA work. Follow-up answers clarified that core should
prefer minimal concepts, scopes should replace project as the general
abstraction, batching should be generic, auth should be protocolized, and
clients should render one KOTA-owned typed UI tree.

## Initiative

Architecture simplification and protocol clarity: KOTA should be explainable
through a small number of typed contracts rather than parallel mechanisms and
prompt-only conventions.

## Acceptance Evidence

- The committed architecture concept map and scenario matrix.
- `pnpm typecheck` output.
- Task queue validation output showing the normalized tasks remain valid.
