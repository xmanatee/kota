---
id: task-approval-telegram-notification
title: Notify operator via Telegram when a tool call is queued for approval
status: done
priority: p2
area: workflow
summary: The approval queue fires an `approval.requested` event but nothing subscribes to it. Operators must poll `kota approval list` to know there is a pending item. Add a Telegram notification on approval request, following the pattern of `failure-alert.ts`.
created_at: 2026-03-20
updated_at: 2026-03-20T03:10:00Z
---

## Problem

`ApprovalQueue.request()` emits `approval.requested` on the event bus, but no consumer subscribes to it. The approval CLI (`kota approval list/approve/reject`) was just added, but without proactive notification, remote operators have no signal that approval is waiting. The daemon may be blocked silently for an indefinite period.

The Telegram failure-alert pattern (`src/core/workflow/failure-alert.ts`) already demonstrates how to subscribe to a bus event and fire a Telegram message.

## Desired Outcome

- A new `subscribeApprovalNotification(bus, log?)` function mirrors the failure-alert pattern.
- When `approval.requested` fires, a Telegram message is sent to `TELEGRAM_ALERT_CHAT_ID` with: tool name, risk level, reason, and approval ID.
- The message format should allow the operator to copy-paste the ID into `kota approval approve <id>` or `kota approval reject <id>`.
- If `TELEGRAM_BOT_TOKEN` or `TELEGRAM_ALERT_CHAT_ID` are unset, the subscription is a no-op (same as failure-alert).
- The subscriber is wired into the daemon startup alongside `subscribeWorkflowFailureAlert`.

## Constraints

- Follow the structure of `failure-alert.ts` closely — do not add new dependencies.
- Do not modify `ApprovalQueue` internals; subscribe only to the existing event.
- Notification is best-effort; a send failure must not crash the daemon.

## Done When

- Sending a tool call to the approval queue causes a Telegram message to appear when the bot token and chat ID are configured.
- Tests verify the notification is triggered on `approval.requested` and is a no-op when credentials are absent.
