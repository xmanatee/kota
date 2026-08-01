---
id: task-render-shared-ui-surfaces-in-the-web-client
title: Render shared UI surfaces in the web client
status: ready
priority: p1
area: client
task_class: Product
depends_on: [task-make-ui-contributions-the-only-surface-assembly-pa, task-generate-client-bindings-from-the-daemon-ui-contra]
summary: Make the live React operator UI render daemon-owned ui.surface.v1 navigation, facts, forms, and actions instead of a hardcoded panel inventory.
created_at: 2026-07-31T16:00:55.526Z
updated_at: 2026-08-01T22:42:07.444Z
---

## Problem

The web client contains a fixture-only HTML renderer in
`clients/web/src/api/uiSurfaceRender.ts`, but the live dashboard does not call
`/ui/surfaces`. `clients/web/src/components/sidebar/Sidebar.tsx` hardcodes the
five intents and assembles a separate inventory of status, inbox, workflow,
task, knowledge, setup, and control panels. Daemon UI semantics therefore have
to be reimplemented in React and can drift from CLI and native clients.

## Desired Outcome

The live React operator experience loads the shared UI bundle and renders its
navigation, nodes, conditions, readiness, forms, confirmation, and actions
through one web renderer. React owns layout, accessibility, responsiveness,
and browser affordances; the daemon graph owns what exists and what it means.

## Constraints

- Do not add a second dashboard mode or keep the hardcoded sidebar as a
  fallback. Migrate and delete the superseded semantic inventory.
- Reuse the existing web design system and query/event infrastructure.
- Specialized React components are allowed only as renderers for typed shared
  nodes/extensions; they must not become alternate business-logic sources.
- If a current screen cannot be represented, extend the canonical UI contract
  in its owning task instead of adding a client-only bypass.

## Done When

- The production dashboard fetches and live-refreshes `ui.surface.v1` through
  the daemon client.
- One exhaustive React node/action renderer handles every generated UI union
  arm, including forms, confirmations, unavailable states, logs, and links.
- The hardcoded intent/panel catalog in `Sidebar.tsx` and fixture-only renderer
  path are removed or reduced to native presentation primitives.
- Existing operator capabilities remain reachable through graph-declared
  navigation and execute graph-declared typed actions.

## Source / Intent

Owner request on 2026-07-31: define the daemon interface once and let web,
terminal, desktop, and mobile clients render it. Audit evidence found live UI
usage only in the CLI; web references to `UiSurfaceBundle` stop at the static
fixture renderer while `Sidebar.tsx` owns a second semantic catalog.

## Initiative

One canonical capability mechanism per KOTA boundary.

## Acceptance Evidence

- Browser screenshots at desktop and narrow mobile widths showing Status,
  Inbox, Work, Knowledge, and Setup derived from the same captured daemon
  bundle used by the CLI transcript.
- A browser trace demonstrating one read action, one confirmed write action,
  one form submission, and live refresh after an SSE event.
- A rendered parity artifact mapping every surface/action id in the daemon
  bundle to the live web renderer, plus a search proving the old panel catalog
  is gone.
