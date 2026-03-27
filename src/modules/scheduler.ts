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
  skills: [{ name: "scheduler", promptPath: "src/modules/skills/scheduler.md" }],
};

export default schedulerModule;
