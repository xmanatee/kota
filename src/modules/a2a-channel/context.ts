import type { ModuleContext } from "#core/modules/module-types.js";

/** Daemon discovery, durable callback storage, diagnostics and public card projection. */
export type A2AContext = Pick<ModuleContext, "cwd" | "storage" | "log" | "getModuleSummaries">;
