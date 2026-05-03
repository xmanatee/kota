---
id: task-share-macos-and-ios-clients-in-one-apple-codebase
title: Share macOS and iOS clients in one Apple codebase
status: done
priority: p2
area: client
summary: Restructure the macOS menu bar app and a new iOS app so they share Swift sources for daemon transport, state, and views, with platform-specific shells, instead of duplicating logic across separate trees.
created_at: 2026-04-28T23:56:41.196Z
updated_at: 2026-05-03T02:44:32.321Z
---

## Problem

`clients/macos/` is a SwiftUI menu bar app. There is no native iOS client
today; mobile is React Native under `clients/mobile/`. The owner wants
both Apple platforms (macOS and iOS) to ship as fully-functional native
apps that share as much logic as is reasonable, with platform-specific
divergence only where the platform actually differs.

If a separate iOS Swift project is built without restructuring, the daemon
client wrapper, daemon discovery, auth/keychain handling, state models,
and most views will be duplicated, drift apart, and lose the
testability/parity that already exists for macOS.

## Desired Outcome

The Apple Swift client tree is restructured so a single Package
contributes shared sources used by both a macOS menu bar app and an iOS
app:

- daemon transport / `KotaClient` wrapper, auth, discovery, voice, push
  routing, and shared state/view-model types live in one shared target;
- macOS-only and iOS-only code (menu bar shell, app delegate, push
  registration, navigation) live in thin platform targets that depend on
  the shared target;
- both apps build, run, and pass tests independently, with no duplicated
  logic between them.

## Constraints

- Keep clients thin. Shared code must not start a second KOTA runtime,
  parse `.kota/` files, or own daemon-side concepts.
- Do not adopt a cross-platform UI framework (e.g. RN, Flutter, Compose
  Multiplatform) for the Apple side; stay native SwiftUI per the
  `clients/AGENTS.md` convention. Sharing happens at the Swift package
  level.
- Do not break the existing macOS menu bar app, its build script, or its
  tests during restructuring. Move first, then add iOS.
- React Native `clients/mobile/` continues to exist and is out of scope
  for this task. The owner's intent is shared Apple-platform Swift code,
  not unifying RN with Swift.
- Shared state initialization must be testable without OS bundle side
  effects. Coordinate with `task-make-native-client-state-models-
  testable-without-o`: the restructure is the right time to inject
  notification/discovery/polling rather than re-introduce the same
  workaround in two places.
- Daemon protocol coverage must keep up: anything the iOS app ships
  must be exercised by integration evidence, not just decoders.
  Coordinate with `task-add-client-runtime-and-visual-evidence-gates-
  for-o`.

## Done When

- The Apple client tree is restructured so a shared Swift target hosts
  the daemon client wrapper, discovery, auth, state models, and shared
  views; macOS and iOS targets depend on it and contain only
  platform-specific shells.
- A new iOS app target builds and runs, talks to the daemon over the
  same control API and SSE stream, and exercises at least one
  representative operator flow (e.g. capture/recall/answer or task
  search) end-to-end with rendered evidence.
- The macOS menu bar app continues to build, run, and pass its existing
  Swift tests after the move; no behavior regressions in the menu bar.
- Shared state can be constructed in tests without
  `UNUserNotificationCenter.current()` or live polling. At least one
  shared integrated state/view test runs in both macOS and iOS targets.
- `clients/macos/AGENTS.md` and a new `clients/ios/AGENTS.md` (or a
  unified `clients/apple/AGENTS.md`, depending on the chosen layout)
  document the shared/platform split, the build commands, and the
  testability conventions.

## Source / Intent

Owner request captured 2026-04-29 in
`data/inbox/make-apple-clients-consistent.md`:

> it probably makes sense to share the app for macos and ios ... maybe
> some would have additional functionality or different setup, but to
> avoid duplication of similar pieces of logic they could share the
> codebase and have as much 'shared' as possible/reasonable... they must
> both be fully functional

Repo state on 2026-04-29: `clients/macos/` is a SwiftUI menu bar app
with `Package.swift`, `Sources/`, and `Tests/`. There is no
`clients/ios/` directory. `clients/mobile/` is React Native and is not
the target of this consolidation.

## Initiative

Operator clients: ship native Apple coverage that scales without code
duplication, so future operator features land once for both macOS and
iOS rather than twice.

## Acceptance Evidence

- Build logs or screenshots showing both the macOS menu bar app and the
  new iOS app launching, connecting to a running daemon, and rendering
  at least one shared operator view.
- Diff or directory listing showing the shared Swift target and the two
  thin platform targets, with no duplicated daemon client / state
  source files.
- Test output covering shared state/view tests passing on both macOS
  and iOS test runs.
- Updated `AGENTS.md` files describing the shared/platform layout.
