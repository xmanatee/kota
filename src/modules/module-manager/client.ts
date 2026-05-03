/**
 * Modules namespace client contract.
 *
 * The module-manager module owns the `modules` KotaClient namespace surface
 * end-to-end: this file declares the per-module summary type, the list result
 * envelope, and the `ModulesClient` interface that the `KotaClient` aggregate
 * composes. Both the local-side handler (`localClient(ctx)` in `index.ts`)
 * and the daemon-side handler (`daemonClient(link)` in `index.ts`) realize
 * this contract; the `kota module list` CLI consumes it through
 * `ctx.client.modules`.
 *
 * `modulesAdmin` (inspect, reload) is a separate namespace also owned by
 * this module and stays declared in `#core/server/kota-client.js` until its
 * own end-to-end migration lands.
 */

/**
 * Loaded-module summary surfaced by `modules.list`.
 *
 * The shape mirrors `ModuleSummary` but is intentionally narrower: only fields
 * an operator browsing the runtime needs to make sense of what is loaded and
 * what each module contributes. Fuller introspection (per-tool listing,
 * full skill bodies) stays on the module-manager CLI/route surface.
 */
export type ModuleListEntry = {
  name: string;
  source: "project" | "installed" | "foreign";
  status: "loaded" | "failed";
  version?: string;
  description?: string;
  toolCount: number;
  workflowCount: number;
  commandCount: number;
  channelCount: number;
  skillCount: number;
  agentCount: number;
  loadError?: string;
};

export type ModulesListResult = {
  modules: ModuleListEntry[];
};

/**
 * Loaded-module operations.
 *
 * `list` returns the runtime view of loaded modules. Daemon mode reports
 * the modules loaded by the daemon process; local mode reports the modules
 * loaded by the CLI process (the same view `kota module list` already
 * exposes). `failed` entries carry the load error so the navigator can
 * show why a module is not available without falling back to log scraping.
 */
export interface ModulesClient {
  list(): Promise<ModulesListResult>;
}
