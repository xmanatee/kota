/**
 * Scheduler extension — timed reminders, recurring tasks, and event-triggered
 * automations.
 *
 * Extracted from the hardcoded tool list using the KotaExtension protocol.
 * Registers the `schedule` tool in the `management` group.
 */

import type { KotaExtension } from "../../extension-types.js";
import { runSchedule, scheduleTool } from "../../tools/schedule.js";

const schedulerModule: KotaExtension = {
  name: "scheduler",
  version: "1.0.0",
  description: "Timed reminders, recurring tasks, and event-triggered automations",
  tools: [
    {
      tool: scheduleTool,
      runner: runSchedule,
      risk: "moderate",
      kind: "action",
      group: "management",
    },
  ],
  skills: [{ name: "scheduler", promptPath: "src/extensions/skills/scheduler.md" }],
};

export default schedulerModule;
