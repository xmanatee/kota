/**
 * Scheduler module config slice.
 *
 * Owns the top-level `scheduler` field — autonomous workflow dispatch
 * window and daemon-wide run concurrency. The `dispatchWindow` validator lives in
 * core because the runtime invokes it at scheduling time, but the slice
 * shape and sanitize/merge live here.
 */

import { type ModuleConfigSlice, registerConfigSlice } from "#core/config/config-slice.js";
import { isWorkflowConcurrency } from "#core/workflow/concurrency.js";
import { type DispatchWindow, validateDispatchWindow } from "#core/workflow/dispatch-window.js";

export type SchedulerConfig = {
  /** Restrict autonomous dispatch to a time-of-day window. */
  dispatchWindow?: DispatchWindow;
  /** Max simultaneous top-level automation runs. Default: 4. */
  concurrency?: number;
};

declare module "#core/config/config-slice.js" {
  interface KotaModuleConfigRegistry {
    scheduler: SchedulerConfig;
  }
}

function sanitizeScheduler(raw: unknown): SchedulerConfig | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const s: SchedulerConfig = {};
  if (src.dispatchWindow !== undefined) {
    const err = validateDispatchWindow(src.dispatchWindow);
    if (!err) {
      const dw = src.dispatchWindow as Record<string, unknown>;
      const window: DispatchWindow = { start: dw.start as string, end: dw.end as string };
      if (Array.isArray(dw.days)) window.days = dw.days as DispatchWindow["days"];
      s.dispatchWindow = window;
    }
  }
  if (isWorkflowConcurrency(src.concurrency)) {
    s.concurrency = src.concurrency;
  }
  return Object.keys(s).length > 0 ? s : undefined;
}

export const schedulerConfigSlice: ModuleConfigSlice<"scheduler"> = {
  key: "scheduler",
  description: "Scheduler dispatch window and concurrency settings",
  sanitize: sanitizeScheduler,
  merge: (base, override) => ({ ...base, ...override }),
  projectConfigSafety: "authority",
  schemaSource: {
    relativePath: "src/modules/scheduler/config-slice.ts",
    typeName: "SchedulerConfig",
  },
};

registerConfigSlice(schedulerConfigSlice, "scheduler");
