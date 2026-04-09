---
id: task-slack-notification-module
title: Add Slack notification module for workflow events
status: done
priority: p3
area: modules
summary: KOTA supports Telegram and HTTP webhook notifications but has no Slack module. Teams using Slack for ops visibility cannot get workflow failure alerts, approval requests, or attention digests without a custom webhook workaround.
created_at: 2026-03-31T01:15:00Z
updated_at: 2026-03-31T13:43:00Z
---

## Problem

KOTA's notification architecture decouples emitters from consumers via typed bus events (`workflow.failure.alert`, `workflow.budget.exceeded`, `workflow.attention.digest`, `workflow.cost.limit.reached`, `approval.requested`). The Telegram and webhook modules subscribe to these events. Slack — the dominant ops chat platform for many teams — has no native KOTA module, so operators must use the generic webhook module with manual Slack formatting or write their own.

Slack's Incoming Webhooks and Block Kit format are meaningfully different from a raw JSON POST, and interactive approval requests could use Slack's native button blocks if exposed.

## Desired Outcome

A `slack` module contributed under `src/modules/slack.ts` that:
- Subscribes to the same bus events as the `telegram` and `webhook` modules.
- Sends formatted Slack messages via Incoming Webhooks (no OAuth app required).
- Uses Block Kit for rich formatting: workflow name, status, cost, and run link.
- Config key `slack` in `kota.config`: `{ webhookUrl: string, events?: string[] }`.
- `events` defaults to all four notification events (same behavior as webhook module).

References: https://api.slack.com/messaging/webhooks, https://api.slack.com/block-kit

## Constraints

- Use Slack Incoming Webhooks only — no bot token OAuth flow in this task.
- Follow the same module pattern as `src/modules/webhook.ts` (subscribe in `onLoad`, unsubscribe in `onUnload`).
- No new runtime dependencies beyond Node's built-in `fetch`.
- Slack message format should be human-readable without requiring deep KOTA knowledge.

## Done When

- `slack` module subscribes to notification bus events and POSTs to the configured Incoming Webhook URL.
- Messages use Block Kit with at least: event type header, workflow name, status, and relevant detail (cost, approval question, etc.).
- Config validation rejects missing `webhookUrl` with a clear error.
- Module is registered in `src/modules/index.ts`.
- At least one test covers the message formatting and send path (can stub `fetch`).
- `docs/NOTIFICATIONS.md` documents the Slack module and config.
