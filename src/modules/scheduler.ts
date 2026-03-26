/**
 * Scheduler module — timed reminders, recurring tasks, and event-triggered automations.
 *
 * Extracted from the hardcoded tool list using the KotaExtension protocol.
 * Registers the `schedule` tool in the `management` group.
 */

import type { KotaExtension } from "../extension-types.js";
import { runSchedule, scheduleTool } from "../tools/schedule.js";

const schedulerModule: KotaExtension = {
  name: "scheduler",
  version: "1.0.0",
  description: "Timed reminders, recurring tasks, and event-triggered automations",
  tools: [
    {
      tool: scheduleTool,
      runner: runSchedule,
      group: "management",
    },
  ],
  promptSection: () =>
    "Time-based and event-based scheduling. " +
    "Use natural time expressions ('in 30 minutes', 'tomorrow at 9am'). " +
    "Workflows can subscribe to scheduler events instead of embedding prompt actions in schedules. " +
    "Event triggers react to runtime.idle, workflow.completed, session.start, session.end, or custom events.",
};

export default schedulerModule;
