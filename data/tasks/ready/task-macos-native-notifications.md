---
id: task-macos-native-notifications
title: Add macOS native notifications for critical workflow events
status: ready
priority: p2
area: client
summary: The macOS menu bar client polls the daemon every 5 seconds but does not surface critical events (workflow failures, pending approvals) as native OS notifications. Operators must watch the menu bar icon to catch urgent items.
created_at: 2026-04-10T09:20:00Z
updated_at: 2026-04-10T09:20:00Z
---

## Problem

The macOS menu bar app learns about workflow failures and pending approvals only through its 5-second poll cycle. If the app is not in view, critical events go unnoticed until the operator opens the popover. By contrast, Telegram already delivers immediate alerts for the same events. Operators running the macOS client as their primary interface are at a disadvantage.

The app currently imports no notification framework and has no permission-request flow.

## Desired Outcome

- The app requests `UNUserNotificationCenter` authorization on first launch (once, with a clear explanation).
- A `workflow.failure.alert` poll result triggers a native notification: title "Workflow failed", body includes the workflow name and a short error excerpt.
- A new pending approval (one that was not present in the previous poll) triggers a native notification: title "Approval needed", body includes the tool name and a short context excerpt.
- Tapping a notification opens or focuses the menu bar app and, where applicable, scrolls to the relevant item.
- A user setting (toggle in the popover) enables or disables notifications independently; default is enabled.
- No notification is sent when the app is already visible and the popover is open.

## Constraints

- Use `UserNotifications` framework (macOS 10.14+, compatible with the app's existing macOS 13+ deployment target).
- Notification state is compared against the previous poll result; only newly appearing items trigger alerts, not repeated polls.
- No daemon changes required; all logic is client-side in `AppState.swift` and a new `NotificationManager.swift`.
- Failures caused by cancelled or paused workflows should not trigger failure notifications.

## Done When

- App requests notification permission on first launch.
- Workflow failure and new pending-approval events produce native macOS banners.
- Notification tap brings the popover into focus.
- User can disable notifications via a toggle in the popover settings area.
- Notifications do not fire redundantly when the popover is already open.
