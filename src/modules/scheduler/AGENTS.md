# Scheduler Module

This directory owns the `scheduler` repo module — timed reminders, recurring tasks, and event-triggered automations.

- Registers the `schedule` tool in the `management` tool group.
- Owns the `NotificationHub` singleton. Module routes resolve it through
  `getNotificationHub()`; `onLoad` also registers the same instance under
  `NOTIFICATION_HUB_PROVIDER_TYPE` so the HTTP server can wire the scheduler
  bus and timer to it without importing module code.
- Contributes the `/api/schedules` and `/api/notifications` HTTP routes via
  `KotaModule.routes`.

Weekly quota policy is opt-in through scheduler configuration. The workflow
runtime owns its independent admission hold; the selected harness reads the
authoritative account quota. Reserve one configured percentage per full UTC
day until reset, with no reserve in the final 24 hours. Active runs and their
required children may drain. Probe failures retain the last admission decision;
startup waits for a valid snapshot. Disabling the policy releases only its hold.
