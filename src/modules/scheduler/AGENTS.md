# Scheduler Module

This directory owns the `scheduler` repo module — timed reminders, recurring tasks, and event-triggered automations.

- Registers the `schedule` tool in the `management` tool group.
- Owns the `NotificationHub` singleton. Module routes resolve it through
  `getNotificationHub()`; `onLoad` also registers the same instance under
  `NOTIFICATION_HUB_PROVIDER_TYPE` so the HTTP server can wire the scheduler
  bus and timer to it without importing module code.
- Contributes the `/api/schedules` and `/api/notifications` HTTP routes via
  `KotaModule.routes`.
