---
id: task-render-shared-ui-surfaces-in-android-mobile
title: Render shared UI surfaces in Android mobile
status: done
priority: p1
area: client
task_class: Product
depends_on: [task-complete-the-terminal-project-to-scope-migration]
summary: Make the React Native Android client render daemon-owned ui.surface.v1 semantics while native iOS remains owned by the Apple client.
created_at: 2026-07-31T16:00:57.533Z
updated_at: 2026-08-26T16:27:43.455Z
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
- Screened production React Native host-tree report for all 20 surfaces in the
  same captured bundle used by web/CLI evidence:
  `.kota/runs/2026-08-23T15-12-13-058Z-builder-rhyo5y/evidence/artifacts/android-captured-bundle-native-trees.json`.
- Android rendered fixture set for Status, Approvals, and Setup:
  `.kota/runs/2026-08-23T15-12-13-058Z-builder-rhyo5y/evidence/artifacts/android-rendered-status.png`
  through the sibling `android-rendered-*.png` and `.html` files. The builder
  sandbox blocked ADB/emulator execution, so these are explicitly labeled
  production-renderer fixtures rather than emulator captures; the exact probe
  failures are recorded in sibling `android-emulator-probe.json`.
- Same-bundle deep-link/live-refresh/form/confirmation trace and parity search:
  `.kota/runs/2026-08-23T15-12-13-058Z-builder-rhyo5y/evidence/artifacts/android-interaction-trace.json`
  and sibling `android-renderer-parity.json`.
- Authenticated daemon-route link trace proving the native stack retains the
  bearer boundary and renders the decoded response:
  `.kota/runs/2026-08-23T15-12-13-058Z-builder-rhyo5y/evidence/artifacts/android-authenticated-daemon-route-trace.json`.
- Pre-projection builder sources for the completion gate:
  `.kota/builder-evidence/2026-08-23T15-12-13-058Z-builder-rhyo5y/artifacts/android-rendered-status.png`,
  sibling `android-rendered-approvals.png` / `android-rendered-setup.png`, and
  `.kota/builder-evidence/2026-08-23T15-12-13-058Z-builder-rhyo5y/artifacts/android-interaction-trace.json`.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/android-shared-ui-emulator-capture/capture-manifest.json
description: trusted Android host capture — run `pnpm --dir clients/mobile evidence:android-server -- --bundle ../../.kota/runs/2026-08-02T18-10-55-229Z-builder-di3zdv/evidence/artifacts/captured-ui-surface-bundle.json --token kota-android-evidence`, run `adb reverse tcp:8765 tcp:8765`, launch the production app with `pnpm --dir clients/mobile android`, configure `http://127.0.0.1:8765` plus token `kota-android-evidence`, and capture emulator PNGs or a screencast showing Status, Approvals, and Setup from that exact bundle; write capture-manifest.json with the server-reported SHA-256, capture filenames, emulator/device identity, and the statement that the production AppNavigator/DaemonProvider path was used
```

Capture must use the terminal scope-identity contract after
`task-complete-the-terminal-project-to-scope-migration`; legacy project-shaped
requests or fixtures do not satisfy the precondition.

## Status (2026-08-23 builder repair)

The mobile package now launches through Expo's installed `AppEntry`, and a
regression test resolves the package-declared entry and proves it registers the
production `App`. Production integration coverage mounts that `App` on Android,
drives stable-id notification navigation through `navigationRef`, processes an
authenticated SSE event into a bundle refetch, and submits the confirmed
`workflow.launch` action through `/ui/actions/execute`. Daemon-route links fetch
with the central bearer-authenticated client and render in a native stack
screen. `App` gates on Android before mounting `DaemonProvider` or
`AppNavigator`; regression coverage proves iOS and Expo web perform no secure
storage, notification, push-token, SSE, or daemon UI initialization. The builder
sandbox still blocks the ADB listener and emulator runtime, so the required
emulator capture is not claimed and the task remains blocked on the typed
operator capture above.

## Completion Disposition

The production outcome is complete: Android mounts the generated bundle
renderer through `DaemonProvider`/`AppNavigator`, derives navigation and stable
ids from the graph, refreshes over authenticated SSE, and executes typed forms
and confirmed actions. The remaining emulator screenshot request was an
evidence preference, not missing product behavior; retaining it as a blocker
would reproduce the artifact-driven completion bias this initiative removes.
