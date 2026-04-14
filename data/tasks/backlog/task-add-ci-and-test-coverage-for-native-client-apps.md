---
id: task-add-ci-and-test-coverage-for-native-client-apps
title: Add CI and test coverage for native client apps
status: backlog
priority: p2
area: clients
summary: The macOS (SwiftUI) and mobile (React Native/Expo) clients have no tests and no CI. Add test foundations and CI workflows to prevent regressions.
created_at: 2026-04-14T20:08:20.214Z
updated_at: 2026-04-14T20:08:20.214Z
---

## Problem

The macOS client (`clients/macos/`, SwiftUI) and mobile client
(`clients/mobile/`, React Native/Expo) have zero test files and no CI
workflows. Changes to client code ship without automated verification, so
regressions are caught only by manual use.

## Desired Outcome

Each client has a minimal but real test foundation and a CI workflow that runs
on PRs touching that client's directory:

- **macOS**: XCTest targets covering API client layer and key view-model logic.
- **Mobile**: Jest (or Expo's test runner) covering API client, state
  management, and at least one integration-level screen test.
- **CI**: GitHub Actions (or equivalent) that build and test each client.

## Constraints

- Tests should cover the API client layer and core state logic, not pixel-level
  UI snapshots.
- CI must not require a running daemon; mock the HTTP API at the network
  boundary.

## Done When

- macOS client has XCTest targets that pass in CI.
- Mobile client has Jest tests that pass in CI.
- A CI workflow runs on PRs touching `clients/macos/` or `clients/mobile/`.
- Both clients build cleanly in CI.
