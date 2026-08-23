---
id: task-render-shared-ui-surfaces-in-android-mobile
title: Render shared UI surfaces in Android mobile
status: ready
priority: p1
area: client
task_class: Product
depends_on: [task-make-ui-contributions-the-only-surface-assembly-pa, task-generate-client-bindings-from-the-daemon-ui-contra]
summary: Make the React Native Android client render daemon-owned ui.surface.v1 semantics while native iOS remains owned by the Apple client.
created_at: 2026-07-31T16:00:57.533Z
updated_at: 2026-08-23T04:27:16.585Z
---

## Problem

React Native contains strict UI conformance decoders but production navigation
never consumes them. `operatorIntents.ts`, `navigation/index.tsx`, and the
intent home screens maintain another five-intent and screen/action inventory.
That duplicates the daemon graph and overlaps with native Apple ownership if
treated as a shared iOS implementation.

## Desired Outcome

The React Native Android product loads the shared UI bundle and renders it with
native mobile components. The daemon graph owns semantic inventory and action
contracts; React Native owns Android layout, navigation presentation, secure
storage, notifications, and other device affordances.

## Constraints

- Scope this product path to Android. Native iOS remains in `clients/apple/`
  unless a separate ownership decision explicitly changes that architecture.
- Do not keep hardcoded navigation as a fallback or create a second UI DSL.
- Use generated bindings from the canonical UI contract and the existing
  centralized daemon HTTP/event context.
- Client-only screens are acceptable only for genuine device setup or a typed
  shared extension renderer, not as alternate operator semantics.

## Done When

- Android production code loads, refreshes, and renders the shared surface
  bundle through one exhaustive React Native renderer.
- Tabs/stacks and deep-link targets derive from graph navigation and stable
  action/surface ids instead of `operatorIntents.ts` and a hardcoded screen map.
- Forms, confirmations, unavailable states, links, logs, and typed actions work
  through the same contract as CLI/web/Apple.
- Superseded semantic navigation helpers and copied UI decoder sources are
  removed once generated bindings own the boundary.

## Source / Intent

Owner request on 2026-07-31: mobile should render the same interface definition
without implementing every capability again. Audit evidence found UI bundle
usage only inside mobile conformance tests, while production navigation
hardcodes all intents and screens. `clients/mobile/AGENTS.md` assigns native
iOS behavior to Apple and Android parity to this client.

## Initiative

One canonical capability mechanism per KOTA boundary.

## Acceptance Evidence

- Android emulator screenshots or a screencast rendering the same captured
  bundle used by the CLI/web/Apple evidence.
- A runtime trace for deep-link navigation, live refresh, form submission, and
  a confirmed action through generated bindings.
- A search/parity artifact proving no hardcoded operator intent/screen catalog
  remains in the Android production path.
