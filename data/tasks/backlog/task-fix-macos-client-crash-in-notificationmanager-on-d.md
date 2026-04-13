---
id: task-fix-macos-client-crash-in-notificationmanager-on-d
title: Fix macOS client crash in NotificationManager on debug builds
status: backlog
priority: p1
area: clients
summary: KotaMenuBar crashes on launch because UNUserNotificationCenter.current() requires a valid bundle proxy, which is nil when running from .build/debug/. NotificationManager must defer or guard notification center access for non-bundled debug builds.
created_at: 2026-04-13T13:59:26.599Z
updated_at: 2026-04-13T13:59:26.599Z
---

## Problem

KotaMenuBar crashes immediately on launch when run from `.build/debug/` (i.e. `swift build && .build/debug/KotaMenuBar`). The crash is an `NSInternalInconsistencyException` in `UNUserNotificationCenter.current()` because `bundleProxyForCurrentProcess` is nil for non-bundled executables.

The crash path: `AppState.init()` → `NotificationManager.shared.requestAuthorization()` → `NotificationManager.init()` → `UNUserNotificationCenter.current()` → abort.

File: `clients/macos/Sources/KotaMenuBar/NotificationManager.swift:7` — `private let center = UNUserNotificationCenter.current()` is evaluated eagerly as a stored property.

## Desired Outcome

The macOS client launches without crashing in both bundled (`.app`) and unbundled (`.build/debug/`) execution contexts. Notification features degrade gracefully when the bundle proxy is unavailable.

## Constraints

- Do not remove notification support for bundled builds.
- The fix should be in `NotificationManager`, not spread across callers.

## Done When

- `swift build && .build/debug/KotaMenuBar` launches without crashing.
- Notifications still work when running from a proper `.app` bundle.
