/**
 * Shared inspect/reload logic for the `modulesAdmin` namespace.
 *
 * `inspectModule` is filesystem-pure (it just walks the module summaries
 * the loader already carries). `reloadModule` is daemon-required because
 * only the running daemon can re-read its config and re-register module
 * contributions.
 */
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  ModuleInspectEntry,
  ModuleInspectResult,
} from "./client.js";

function summaryToEntry(s: ReturnType<ModuleContext["getModuleSummaries"]>[number]): ModuleInspectEntry {
  const entry: ModuleInspectEntry = {
    name: s.name,
    source: s.source,
    status: s.loadError !== undefined ? "failed" : "loaded",
    dependencies: s.dependencies,
    toolNames: s.toolNames,
    workflowNames: s.workflowNames,
    commandNames: s.commandNames,
    routeSummaries: s.routeSummaries,
    channelNames: s.channelNames,
    skillNames: s.skillNames,
    agentNames: s.agentNames,
  };
  if (s.version !== undefined) entry.version = s.version;
  if (s.description !== undefined) entry.description = s.description;
  if (s.health) {
    entry.health = {
      status: s.health.status,
      restartCount: s.health.restartCount,
      ...(s.health.lastRestartAt !== undefined && { lastRestartAt: s.health.lastRestartAt }),
    };
  }
  if (s.commandError !== undefined) entry.commandError = s.commandError;
  if (s.routeError !== undefined) entry.routeError = s.routeError;
  if (s.loadError !== undefined) entry.loadError = s.loadError;
  return entry;
}

export function inspectModule(ctx: ModuleContext, name: string): ModuleInspectResult {
  const summaries = ctx.getModuleSummaries();
  const summary = summaries.find((s) => s.name === name);
  if (!summary) return { found: false };
  return { found: true, module: summaryToEntry(summary) };
}
