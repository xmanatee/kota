/**
 * Scheduler module — timed reminders, recurring tasks, and event-triggered
 * automations.
 *
 * Registers the `schedule` tool in the `management` group, owns the
 * `NotificationHub` (registered as a provider so the HTTP server can wire
 * the scheduler bus and timer to it without importing module code), and
 * contributes the `/api/schedules` and `/api/notifications` HTTP routes.
 */


import type { KotaModule } from "#core/modules/module-types.js";
import { NOTIFICATION_HUB_PROVIDER_TYPE } from "#core/server/notification-hub-provider.js";
import { daemonWriteEffect } from "#core/tools/effect.js";
import { schedulerConfigSlice } from "./config-slice.js";
import { getNotificationHub } from "./notification-hub.js";
import { schedulerRoutes } from "./routes.js";
import { runSchedule, scheduleTool } from "./schedule.js";

export { getNotificationHub, NotificationHub } from "./notification-hub.js";

const schedulerModule: KotaModule = {
  name: "scheduler",
  version: "1.0.0",
  description: "Timed reminders, recurring tasks, and event-triggered automations",
  configSlices: [schedulerConfigSlice],
  tools: [
    {
      tool: scheduleTool,
      runner: runSchedule,
      effect: daemonWriteEffect(),
      group: "management",
    },
  ],
  skills: [{ name: "scheduler", promptPath: "src/modules/scheduler/scheduler.md" }],

  onLoad(ctx) {
    ctx.registerProvider(NOTIFICATION_HUB_PROVIDER_TYPE, getNotificationHub());
  },

  routes: () => schedulerRoutes(),
};

export default schedulerModule;
