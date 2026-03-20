---
id: task-workflow-failure-telegram-alert
title: Send Telegram alert on workflow failure
status: ready
priority: p2
area: workflow
summary: When a workflow run completes with status "failed" or "interrupted", send a Telegram notification if a bot token and chat ID are configured. Closes a visibility gap for unattended overnight runs.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

The workflow runtime runs autonomously but there is no user-facing notification when a run fails or is interrupted. During unattended overnight runs, silent failures require the operator to manually inspect `.kota/runs/` to learn what happened. The Telegram infrastructure (`callTelegramApi`, `TELEGRAM_BOT_TOKEN`) already exists but is not wired to the workflow runtime.

## Desired Outcome

When a `workflow.completed` event is emitted with `status: "failed" | "interrupted"`:
- If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERT_CHAT_ID` environment variables are set, send a short Telegram message with the workflow name, run ID, status, duration, and error summary.
- Success runs produce no notification (noise).
- The alert logic is self-contained and does not pollute the workflow runtime or run store.

## Constraints

- Use `callTelegramApi` from `src/telegram-client.ts` — no new HTTP dependencies.
- Alert should be best-effort: a failure to send the Telegram message must not crash the daemon or propagate as a workflow error.
- Opt-in via env vars only — no config file changes required.
- No mutations to `WorkflowRunStore` or `WorkflowRuntime` internals.

## Done When

- Workflow failures send a Telegram message when env vars are set.
- No notification is sent on success.
- Sending errors are caught and logged, not thrown.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.
