---
id: task-notification-webhook-retry
title: Add retry with backoff to webhook notification delivery
status: backlog
priority: p3
area: extensions
summary: Webhook and Slack notification POSTs are fire-and-forget. A transient network error or downstream service hiccup silently drops the alert. Adding retry with exponential backoff improves delivery reliability without breaking the event subscriber model.
created_at: 2026-04-01T04:03:40Z
updated_at: 2026-04-01T04:03:40Z
---

## Problem

The built-in `webhook` and `slack` extensions post notifications to external URLs but make no attempt to retry on failure. A transient 5xx response, a brief network interruption, or a slow downstream webhook handler causes the alert to be silently lost. Operators may miss failure alerts, approval requests, or budget alerts because of a temporary connectivity issue.

## Desired Outcome

Webhook and Slack notification delivery retries on failure with configurable backoff. The default should be a small number of retries (e.g. 3) with exponential backoff (e.g. 1s, 2s, 4s). Failures after all retries should be logged as a warning. The feature should be opt-in or transparently on by default with sensible defaults.

## Constraints

- Changes are confined to the webhook and slack extension modules (`src/extensions/webhook.ts`, `src/extensions/slack.ts`).
- Retry logic should be extracted into a shared helper to avoid duplication.
- Do not block the notification event handler indefinitely — retries must be async and not hold the bus callback.
- Keep retry count and delay configurable via extension config; use safe defaults if not set.
- Do not add a retry queue that persists across daemon restarts — in-memory retry attempts only.

## Done When

- Webhook and Slack POSTs retry up to a configurable number of times on non-2xx response or network error.
- Retries use exponential backoff with a configurable base delay.
- Final failure after all retries is logged as a warning with the URL and last error.
- Retry count and delay are configurable via the extension config block; defaults apply when not set.
- Unit tests cover retry behavior, final-failure logging, and the shared retry helper.
