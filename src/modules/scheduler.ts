/**
 * Scheduler module — timed reminders, recurring tasks, and event-triggered automations.
 *
 * Extracted from the hardcoded tool list using the KotaModule protocol.
 * Registers the `schedule` tool in the `management` group.
 */

import type { KotaModule } from "../module-types.js";
import { runSchedule, scheduleTool } from "../tools/schedule.js";

const schedulerModule: KotaModule = {
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
    "Set agent_action for autonomous execution when triggered. " +
    "Event triggers react to session.start, session.end, action.complete, or custom events.",
};

export default schedulerModule;
