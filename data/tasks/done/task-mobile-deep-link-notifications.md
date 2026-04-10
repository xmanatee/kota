---
id: task-mobile-deep-link-notifications
title: Deep-link push notifications to the specific approval or run in the mobile client
status: done
priority: p3
area: client
summary: Push notifications for pending approvals open the app home rather than the specific approval item. Deep linking the notification tap directly to the relevant approval or run screen removes the navigation step and makes the mobile client more actionable.
created_at: 2026-04-09T01:50:00Z
updated_at: 2026-04-09T06:30:00Z
---

## Problem

`task-mobile-push-notifications` delivered push notifications when approvals are pending.
Tapping a notification opens the app at the default tab (Status) rather than navigating
directly to the Approvals tab or the specific approval item. The operator must then
manually switch tabs and find the relevant item.

## Desired Outcome

- Notification payload includes a `screen` field (e.g. `"approvals"`) and an optional
  `approvalId` field.
- When the app is opened via notification tap, it navigates directly to the Approvals
  tab and, if an `approvalId` is present, scrolls to or highlights that item.
- Background/foreground notification handling both work (app open vs. app already running).

## Constraints

- Uses Expo Notifications `addNotificationResponseReceivedListener` for tap handling.
- Navigation via existing React Navigation stack — no new screens needed.
- Notification payload schema change must be backward-compatible (old notifications
  without `screen` field just open the app home as before).
- Only approval notifications need deep linking in v1; run completion notifications
  can follow in a separate task if demand exists.

## Done When

- Tapping a pending-approval push notification opens the Approvals tab directly.
- If an `approvalId` is included in the payload, the list scrolls to that item.
- Both foreground (in-app banner) and background (OS notification center) tap paths work.
- Existing push notification tests pass; a test covers the navigation dispatch on tap.

