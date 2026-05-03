/**
 * Module-manager client contracts.
 *
 * The module-manager module owns two KotaClient namespaces end-to-end:
 *
 *  - `modules` — the navigator-shaped runtime view of loaded modules
 *    (`list()`).
 *  - `modulesAdmin` — the admin-shaped per-module operations surfaced by
 *    `kota module inspect <name>` and `kota module reload <name>`
 *    (`inspect(name)`, `reload(name)`).
 *
 * Both contracts live here so the `KotaClient` aggregate composes them by
 * importing from this module instead of declaring the shapes inline. The
 * local-side handler (`localClient(ctx)` in `index.ts`) and the daemon-side
 * handler (`daemonClient(link)` in `index.ts`) realize both interfaces; the
 * `kota module` CLI consumes them through `ctx.client.modules` and
 * `ctx.client.modulesAdmin`.
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

/**
 * Inspection result for `modulesAdmin.inspect(name)`. Carries the full
 * runtime summary the CLI renders in `kota module inspect`. Module-
 * loading details that depend on agent/skill internals stay typed as
 * plain string lists and optional records to keep the contract decoupled
 * from the implementing types.
 */
export type ModuleInspectEntry = {
  name: string;
  source: "project" | "installed" | "foreign";
  version?: string;
  description?: string;
  status: "loaded" | "failed";
  dependencies: string[];
  toolNames: string[];
  workflowNames: string[];
  commandNames: string[];
  routeSummaries: string[];
  channelNames: string[];
  skillNames: string[];
  agentNames: string[];
  health?: {
    status: string;
    restartCount: number;
    lastRestartAt?: string;
  };
  commandError?: string;
  routeError?: string;
  loadError?: string;
};

export type ModuleInspectResult =
  | { found: true; module: ModuleInspectEntry }
  | { found: false };

/**
 * Result of `modulesAdmin.reload(name)`. The handler talks to the
 * running daemon to re-read its config and re-register module
 * contributions; daemon-down surfaces `daemon_required`. `reloaded`
 * carries whether the daemon detected a config change for that
 * specific module name; `workflowsActive` mirrors the daemon's
 * post-reload definition count.
 */
export type ModuleReloadResult =
  | { ok: true; reloaded: boolean; workflowsActive: number }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "daemon_required" };

/**
 * Module-administration operations.
 *
 * `inspect` returns the full per-module summary surfaced by
 * `kota module inspect <name>`; `reload` reissues the daemon's config
 * reload pipeline and reports whether the named module's config
 * changed.
 *
 * `list` already lives on the `modules` namespace as a navigator-shaped
 * summary; this admin namespace keeps `inspect` and `reload` separate so
 * the navigator's narrow `ModuleListEntry` contract stays untouched.
 */
export interface ModulesAdminClient {
  inspect(name: string): Promise<ModuleInspectResult>;
  reload(name: string): Promise<ModuleReloadResult>;
}
