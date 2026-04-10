---
id: task-telegram-inline-approvals
title: Telegram inline keyboard buttons for approval requests
status: done
priority: p3
area: operator
summary: The Telegram module sends approval requests as text messages with CLI commands to copy. Adding inline keyboard buttons (Approve / Reject) would let operators respond directly from Telegram without running a CLI command, closing the approval loop in a single tap.
created_at: 2026-04-10T08:00:00Z
updated_at: 2026-04-10T08:00:00Z
---

## Problem

When the approval queue emits `approval.requested`, the Telegram notification includes the tool name, risk, reason, and raw CLI commands (`kota approval approve <id>` / `kota approval reject <id>`). Operators must copy the ID and run a command in a terminal. This breaks the mobile-operator flow: seeing the notification on a phone but needing a laptop to respond.

Telegram's inline keyboard API allows attaching callback buttons to a message. When a button is pressed, Telegram sends a callback query to the bot, which can then call the approval queue directly.

## Desired Outcome

Approval request messages in Telegram include two inline keyboard buttons: **Approve** and **Reject**. Pressing either button immediately approves or rejects the queued tool call and updates the message to reflect the resolution. No CLI is required.

This requires the Telegram module to poll for (or receive via webhook) callback queries, route them to the approval queue, and edit the original message with the outcome.

## Constraints

- Long polling is acceptable; a webhook variant is optional but should not block the task.
- The polling loop must not block module initialization — run it as a background task.
- Approvals resolved via inline buttons should show the same resolution source as CLI approval (`"telegram-inline"`).
- Fallback: if the daemon is not reachable when a button is pressed, send an error reply to the Telegram callback so the button doesn't silently fail.
- The existing text-based CLI command fallback must remain in the message body for operators without interactive Telegram access.

## Done When

- Approval request messages arrive in Telegram with Approve and Reject buttons.
- Pressing a button resolves the approval and updates the Telegram message to confirm.
- Long-poll loop handles callback queries without interfering with other Telegram notification delivery.
- Existing Telegram notification tests continue to pass.
