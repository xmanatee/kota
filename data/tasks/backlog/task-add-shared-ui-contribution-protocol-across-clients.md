---
id: task-add-shared-ui-contribution-protocol-across-clients
title: Add shared UI contribution protocol across clients
status: backlog
priority: p1
area: client
summary: Define a KOTA-owned typed UI contribution tree for modules and daemon surfaces, then extend conformance so web, macOS/iOS, mobile, and CLI render the same capabilities, forms, actions, and pending requests.
depends_on: [task-promote-projects-into-hierarchical-scopes, task-unify-hooks-and-workflows-under-one-automation-pro, task-add-module-setup-and-auth-requirement-protocol]
created_at: 2026-06-03T13:40:24.598Z
updated_at: 2026-06-03T14:08:54.000Z
---

## Problem

Clients are thin and share daemon contract fixtures, but UI surfaces are still
implemented per client. Modules can contribute tools, workflows, channels,
commands, routes, control routes, skills, and agents, but they cannot declare
operator-facing UI contributions once and have CLI, web, macOS/iOS, and mobile
render the same capabilities, forms, actions, navigation, setup flows, pending
requests, and run views.

The owner wants the CLI to be "just another supported UI" and wants new
functionality to declare what it exposes to the UI so all clients can render it
consistently. Ad hoc per-client screens will keep creating parity gaps.

## Desired Outcome

Define a KOTA-owned typed UI contribution protocol. The daemon exposes a
validated UI tree or contribution graph built from core surfaces and module
contributions. Each client renders that tree with native platform components.

The protocol should cover at least:

- Navigation nodes, sections, lists, detail views, tabs, and empty/error states.
- Text, headings, key/value rows, tables, status badges, progress, logs, and
  links.
- Inputs, toggles, selectors, text fields, secret fields, file/path pickers,
  and URL-mode actions.
- Commands/actions with typed parameters, confirmation requirements, and
  capability readiness.
- Pending owner questions, approvals, setup requirements, live runs,
  automations/hooks, agents, modules, scopes, stores, and channels.
- Extension ids, attachment points, ordering, conditions, permissions, and
  conformance fixtures.

## Constraints

- Do not use HTML as the core protocol. HTML can be a renderer target, but the
  shared contract must be typed, validated, and client-neutral.
- Do not create a second terminal rendering DSL. Integrate with the existing
  `src/modules/rendering/` primitives for CLI rendering where possible.
- Keep clients thin. They render the daemon-provided UI contract and call
  daemon actions; they do not inspect `.kota` files or own runtime logic.
- Use existing JSON Schema/config-schema patterns for forms where appropriate,
  but keep navigation/actions as KOTA-specific typed nodes.
- Extension ids and attachment points must be unique and validated, following
  the same discipline as module ids and Backstage-style frontend extensions.
- This task defines the shared protocol and first renderer parity; it does not
  need to fully redesign every screen in one change.

## Done When

- A typed UI contribution contract exists in the daemon/client boundary and is
  included in conformance fixtures.
- Modules can declare UI contributions or view/action descriptors without
  importing client-specific code.
- Web, CLI, Apple, and mobile clients decode the same fixture and render at
  least one shared surface family from it.
- The first shared surfaces include setup requirements, pending owner
  requests/approvals, workflow or automation definitions, and module
  capability status.
- Tests prove extension ids, attachment points, conditions, and action
  parameter schemas are validated.
- Rendered evidence shows semantic parity across CLI and at least one visual
  client.

## Source / Intent

Owner request from `data/inbox/many.md` and follow-up on 2026-06-03: clients
should use a KOTA-owned typed UI tree, and "CLI must be just another supported
UI" with the same functionality where necessary.

Relevant current code/docs: `clients/AGENTS.md`, `clients/conformance/`,
`clients/web/`, `clients/apple/`, `clients/mobile/`,
`src/modules/cli/navigator.ts`, `src/modules/rendering/`, and
`src/core/daemon/daemon-control-types.ts`.

Research references: Backstage frontend plugin/extension contracts
(`https://backstage.io/docs/frontend-system/architecture/plugins/`,
`https://backstage.io/docs/frontend-system/architecture/extensions/`), JSON
Forms architecture (`https://jsonforms.io/docs/architecture/`), Ink
(`https://github.com/vadimdemedes/ink`), Bubble Tea
(`https://github.com/charmbracelet/bubbletea`), and Textual
(`https://textual.textualize.io/guide/widgets/`).

## Initiative

One daemon UI protocol, many renderers: new KOTA capabilities should become
available in every supported client through one typed contribution contract.

## Acceptance Evidence

- Updated conformance fixture and decoder tests for the UI contribution
  protocol.
- CLI transcript under `.kota/runs/<run-id>/transcript.txt` rendering a shared
  UI surface.
- Web screenshot or Playwright HTML report under `.kota/runs/<run-id>/`
  rendering the same shared UI surface.
- Swift and mobile decoder test output proving the same fixture is accepted.
