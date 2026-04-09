/**
 * Scheduler module — timed reminders, recurring tasks, and event-triggered
 * automations.
 *
 * Extracted from the hardcoded tool list using the KotaModule protocol.
 * Registers the `schedule` tool in the `management` group.
 */

import type { KotaModule } from "../../module-types.js";
import { runSchedule, scheduleTool } from "./schedule.js";

const schedulerModule: KotaModule = {
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
  skills: [{ name: "scheduler", promptPath: "src/modules/skills/scheduler.md" }],
};

export default schedulerModule;
