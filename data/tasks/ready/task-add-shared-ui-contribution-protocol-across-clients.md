---
id: task-add-shared-ui-contribution-protocol-across-clients
title: Add shared UI contribution and action protocol across clients
status: ready
priority: p1
area: client
summary: Define a KOTA-owned typed UI contribution and action protocol for modules and daemon surfaces, then extend conformance so web, macOS/iOS, mobile, and CLI render and execute the same capabilities, controls, forms, actions, and pending requests.
depends_on: [task-promote-projects-into-hierarchical-scopes, task-unify-hooks-and-workflows-under-one-automation-pro, task-add-module-setup-and-auth-requirement-protocol]
created_at: 2026-06-03T13:40:24.598Z
updated_at: 2026-06-18T19:36:00.212Z
task_class: Product
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

Current audit update on 2026-06-18: KOTA now has a narrow `ui.surface.v1`
seed for Status and Inbox surfaces, plus setup/auth requirements and module
capability/effect manifests. That is useful groundwork, but it is not the
requested module UI protocol yet. The current surface model is too small,
mostly renders static operator projections, and still treats executable
actions too much like command strings instead of stable typed daemon actions
with parameter schemas, readiness, effects, confirmation, and result/error
semantics.

## Desired Outcome

Define a KOTA-owned typed UI contribution and action protocol. The daemon
exposes a validated UI tree or contribution graph built from core surfaces and
module contributions. Each client renders that tree with native platform
components and calls typed daemon actions instead of shell-like command
strings.

The protocol should cover at least:

- Navigation nodes, sections, lists, detail views, tabs, and empty/error states.
- Text, headings, key/value rows, tables, status badges, progress, logs, and
  links.
- Data facts, structured blocks, metrics, small panels, dense tables, and
  status/progress summaries that are not tied to a specific client framework.
- Inputs, toggles, selectors, text fields, secret fields, file/path pickers,
  and URL-mode actions.
- Commands/actions with typed parameters, confirmation requirements, and
  capability readiness.
- Parameter controls for model selection, effort, autonomy mode, launch
  presets, defaults, and other run/session options exposed by KOTA.
- Action handlers or small controllers for cases where declaration alone is
  insufficient, while keeping execution inside daemon-owned typed action
  routes.
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
- Actions must have stable ids, typed parameter schemas, explicit
  confirmation/effect/readiness metadata, and typed result/error outcomes.
  Clients must not execute arbitrary command strings as the primary action
  model.
- This task defines the shared protocol and first renderer parity. It does not
  need to fully redesign every screen, but it must prove that modules can
  declare visible controls and executable actions once.

## Done When

- A typed UI contribution contract exists in the daemon/client boundary and is
  included in conformance fixtures.
- Modules can declare UI contributions or view/action descriptors without
  importing client-specific code.
- A demonstration module declares facts, metrics, structured text, lists or
  tables, status/progress, selectable parameters, setup/auth controls, and
  typed actions once through the shared protocol.
- Web, CLI, Apple, and mobile clients decode the same fixture and render the
  same semantic controls, even when visual presentation differs by platform.
- The first shared surfaces include setup requirements, pending owner
  requests/approvals, workflow or automation definitions, run/session launch
  controls, and module capability status.
- Tests prove extension ids, attachment points, conditions, action parameter
  schemas, confirmation metadata, readiness states, and result/error arms are
  validated.
- Rendered evidence shows semantic parity across CLI and at least one visual
  client, and decoder/conformance evidence covers the remaining clients.

## Source / Intent

Owner request from `data/inbox/many.md`, follow-up on 2026-06-03, and
direction audit on 2026-06-18: clients
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
  protocol and typed action model.
- CLI transcript under `.kota/runs/<run-id>/transcript.txt` rendering a shared
  UI surface and executing a typed action without using an arbitrary shell-like
  command string as the protocol.
- Web screenshot or Playwright HTML report under `.kota/runs/<run-id>/`
  rendering the same shared UI surface.
- Swift and mobile decoder test output proving the same fixture is accepted.
