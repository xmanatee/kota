/** Reminder tool. The daemon scope runtime owns persistence and delivery. */

import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { daemonWriteEffect } from "#core/tools/effect.js";
import { schedulerConfigSlice } from "./config-slice.js";
import { runSchedule, scheduleTool } from "./schedule.js";

const schedulerModule: KotaModule = {
	name: "scheduler",
	version: "1.0.0",
	description:
		"Timed, recurring, and event-triggered reminders",
	configSlices: [schedulerConfigSlice],
	tools: (ctx) => [
		{
			tool: scheduleTool,
			runner: async (input, context) => {
				const daemon = ctx.getProvider(DAEMON_SCOPE_PROVIDER_TYPE);
				if (!daemon)
					return {
						content: "Reminders require a daemon-hosted session",
						is_error: true,
					};
				const selected = daemon.resolveScopeRuntime(context?.scopeId);
				if (!selected.ok)
					return {
						content: `Unknown scope: ${selected.error.scopeId}`,
						is_error: true,
					};
				return runSchedule(input, selected.runtime.scheduler);
			},
			effect: daemonWriteEffect(),
			group: "management",
		},
	],
	skills: [
		{ name: "scheduler", promptPath: "src/modules/scheduler/scheduler.md" },
	],

};

export default schedulerModule;
