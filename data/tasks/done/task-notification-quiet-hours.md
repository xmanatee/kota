---
id: task-notification-quiet-hours
title: Add configurable quiet hours to suppress non-critical channel notifications outside specified hours
status: done
priority: p2
area: runtime
summary: Channel notifications (Telegram, Slack) fire at any hour, disturbing operators with low-urgency alerts. A quiet-hours config window holds non-critical notifications and delivers them in a batch when the window opens.
created_at: 2026-04-02T01:18:54Z
updated_at: 2026-04-09T03:10:00Z
---

## Problem

`workflow.attention.digest` and `workflow.budget.exceeded` events deliver channel
notifications (Telegram, Slack) the moment they are emitted, regardless of the time
of day. Operators who leave the daemon running overnight get woken by low-urgency
digests at 2am with no way to silence them short of disabling the channel entirely.

The `scheduler.dispatchWindow` task covers restricting when workflows *run*. This is
a complementary concern: operators often want autonomous work to continue 24/7 but
only receive non-urgent alerts during waking hours.

## Desired Outcome

- A `notifications.quietHours` config block:
  ```json
  {
    "notifications": {
      "quietHours": {
        "start": "22:00",
        "end": "08:00",
        "allowCritical": true
      }
    }
  }
  ```
- During quiet hours, low-urgency events (`workflow.attention.digest`,
  `workflow.budget.exceeded`) are held in an in-memory buffer rather than dispatched
  to channel modules.
- When the quiet window ends, held notifications are released as a single batched
  digest message (one message per channel, not one per held event).
- `workflow.failure.alert` is treated as critical and always delivered immediately
  when `allowCritical: true` (the default when the field is absent).
- When no `quietHours` config is set, behavior is identical to today.

## Constraints

- Implemented in the event bus subscription layer or a dedicated notification gate
  — **not** duplicated inside each channel module.
- Hold buffer is in-memory only; notifications held at most until the window next
  opens (lost on daemon restart — acceptable, operator alerted at next opening).
- Timezone: daemon's local timezone (same approach as `scheduler.dispatchWindow`).
- Affects channel delivery only; workflows and the scheduler are unaffected.
- `start` and `end` use HH:MM 24-hour format; spans crossing midnight (e.g. 22:00–08:00)
  are handled correctly.
- Document in `docs/CONFIG.md`.

## Done When

- `notifications.quietHours` accepted in config and validated at startup.
- Non-critical events held during quiet hours; released as a batched summary when
  the window opens.
- `workflow.failure.alert` bypasses quiet hours when `allowCritical: true`.
- Unit test covers: in-window suppression, out-of-window passthrough, batch release
  at window open, midnight-spanning window.
- `docs/CONFIG.md` documents the new config block.
