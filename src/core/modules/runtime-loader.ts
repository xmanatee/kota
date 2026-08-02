/**
 * Full-runtime module loader.
 *
 * The CLI loads modules in `"commands"` mode so subcommand registration
 * stays cheap and side-effect-free. Long-lived runtime hosts cannot use
 * that snapshot: routes contributed by modules with provider-backed
 * `onLoad` (knowledge, memory, history, recall, answer, ...) would expose
 * `/api/*` endpoints whose backing provider was never registered, and the
 * typed accessors on a `"commands"` loader now throw rather than hand
 * back a silently partial snapshot.
 *
 * `loadRuntimeModules` is the single entrypoint runtime hosts use to
 * obtain a `ModuleLoader` that has driven every module's lifecycle to
 * completion. The daemon's `kota daemon` command and the stdio MCP server
 * both consume contributions through a loader returned from here.
 */
import type { KotaConfig } from "#core/config/config.js";
import { discoverModules } from "./module-discovery.js";
import { ModuleLoader } from "./module-loader.js";
import { discoverProjectModules } from "./project-discovery.js";

export type RuntimeLoaderOptions = {
  config: KotaConfig;
  cwd: string;
  verbose?: boolean;
  /** Alternate persisted machine-authority file for embedders. */
  globalConfigPath?: string;
  /** Trusted source directory for modules executed in an isolated copy. */
  installedModuleSourceDir?: string;
};

export async function loadRuntimeModules(
  options: RuntimeLoaderOptions,
): Promise<ModuleLoader> {
  const verbose = options.verbose ?? false;
  const loader = new ModuleLoader(options.config, verbose, {
    mode: "runtime",
    globalConfigPath: options.globalConfigPath,
    installedModuleSourceDir: options.installedModuleSourceDir,
  });
  loader.setCwd(options.cwd);
  const projectModules = await discoverProjectModules();
  const installedModuleSourceDir = options.installedModuleSourceDir ?? options.cwd;
  const installedModules = await discoverModules(installedModuleSourceDir, verbose, {
    globalConfigPath: options.globalConfigPath,
  });
  await loader.loadAll(projectModules, installedModules);
  return loader;
}
