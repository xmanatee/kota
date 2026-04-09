---
id: task-module-crash-alert
title: Alert operator when a foreign module crashes and restarts repeatedly
status: done
priority: p2
area: runtime
summary: Foreign (KEMP) modules can crash and restart silently. Health data is available in kota module inspect but no notification fires when an module enters a crash loop, leaving the operator to discover capability degradation after the fact.
created_at: 2026-04-08T18:02:39Z
updated_at: 2026-04-09T02:45:00Z
---

## Problem

Foreign modules run as separate subprocesses managed by the daemon. When one crashes,
the runtime restarts it automatically. The health state (restart count, last restart time,
status) is tracked internally and exposed via `kota module inspect <name>` and the
daemon's `GET /status` response. However, no channel notification is emitted.

An module in a crash loop may degrade builder runs silently — missing tools fail
quietly or after a timeout — and the operator may not notice until reviewing logs manually.

## Desired Outcome

The daemon emits a `module.crash.alert` event when a foreign module's restart count
exceeds a configurable threshold within a rolling window. The notification identifies the
module by name, reports the restart count and last error if available, and is delivered
via the standard notification channel path (same as `workflow.failure.alert`).

A `healthCheck` config block on the module (or a global `modules.crashAlertThreshold`
config) controls the sensitivity. Default: alert after 3 restarts within 10 minutes.

The alert fires at most once per window to avoid notification storms during extended outages.

## Constraints

- Only applies to foreign (KEMP) modules with active health tracking; in-process
  modules do not crash independently and are excluded.
- Alert rate-limiting: at most one alert per module per configurable cooldown window
  (default 10 minutes).
- No new daemon endpoints required; uses existing health state already collected.
- Threshold defaults should be conservative enough to avoid false positives from expected
  single restarts during daemon boot or config reload.

## Done When

- Daemon monitors restart count for foreign modules and emits `module.crash.alert`
  when the threshold is crossed.
- Notification channels deliver the alert with module name and restart count.
- The cooldown window prevents alert storms.
- Config accepts `modules.crashAlertThreshold` (number) and `modules.crashAlertWindowMs`
  (number, default 600000).
- Unit test covers: threshold crossed → alert emitted; threshold not crossed → no alert;
  cooldown prevents second alert within window.
