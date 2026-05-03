---
id: task-make-native-client-state-models-testable-without-o
title: Make native client state models testable without OS side effects
status: ready
priority: p2
area: client
summary: Refactor macOS and mobile client state initialization so notification, filesystem, network, and daemon discovery side effects are injectable, enabling real AppState/view tests instead of avoiding integrated coverage.
created_at: 2026-04-28T22:36:01.524Z
updated_at: 2026-05-03T01:19:29.874Z
---

## Problem

macOS `AppState` initializes OS and runtime side effects directly:
`NotificationManager.shared.requestAuthorization()` and `startPolling()` run in
`init`. Builder evidence for `TaskSearchView` explicitly avoided constructing
`AppState` in tests because `UNUserNotificationCenter.current()` crashes when
Swift tests run outside an `.app` bundle.

That workaround normalized missing integrated state/view coverage. Similar
patterns can affect mobile or other native clients when filesystem, network,
notification, or daemon-discovery side effects happen during state construction.

## Desired Outcome

Native client state models become testable:

- notification authorization is injected or deferred;
- daemon discovery/client dependencies are injectable;
- polling can be manually controlled in tests;
- view models/AppState can be constructed in unit tests without OS bundle
  requirements;
- real view/state tests replace pure decoder/render-helper-only coverage for
  core operator flows.

## Constraints

- Preserve production behavior for menu bar launch, polling, notifications, and
  daemon discovery.
- Do not introduce heavyweight dependency injection frameworks.
- Keep the client thin; this is about testability, not moving daemon logic into
  native clients.
- Include macOS first because it is the observed failure path; audit mobile for
  the same pattern and update if needed.
- Coordinate with visual/runtime evidence tasks so new tests support rendered
  artifacts where possible.

## Done When

- macOS `AppState` can be constructed in tests without touching
  `UNUserNotificationCenter.current()` or starting real polling.
- At least one integrated macOS state/view test covers a previously untested
  flow such as capability readiness, error presentation, workflow trigger, or
  dashboard availability.
- Mobile/native state initialization is audited and either updated or documented
  as not having the same issue.
- Existing Swift tests remain green.

## Source / Intent

2026-04-27/28 run evidence for `TaskSearchView` said AppState was intentionally
not constructed because notification APIs crash outside an app bundle, and
treated that as "same precedent as Knowledge/Memory/History". The 2026-04-28
owner review exposed the cost of that precedent: UI/state behavior drifted
without tests exercising the actual state container.

## Initiative

Native-client testability: operator clients need integrated state coverage, not
only transport decoding tests.

## Acceptance Evidence

- Swift test output showing `AppState` or equivalent state model constructed in
  tests.
- A new integrated state/view test covering an operator-visible flow.
- A short audit note for mobile/native side-effect initialization.
