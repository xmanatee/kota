/**
 * Foreign module loader — wraps out-of-process modules as KotaModule.
 *
 * Each configured foreign module is started, handed the init/manifest
 * handshake, then presented to the rest of KOTA as a normal KotaModule
 * with tool runners that proxy invocations over the transport.
 */

import { resolve } from "node:path";
import type { ForeignModuleConfig, KempTransport } from "./foreign-module.js";
import { HttpTransport } from "./foreign-module-http.js";
import {
  DEFAULT_MAX_RESTARTS,
  startResilientStdioModule,
} from "./foreign-module-resilient-loader.js";
import {
  buildForeignToolDefs,
  createRawForeignModule,
  HEALTH_CHECK_TIMEOUT_MS,
} from "./foreign-module-session.js";
import { StdioTransport } from "./foreign-module-stdio.js";
import type { KotaModule } from "./module-types.js";
import { printTerminalDiagnostic } from "./terminal-renderer.js";

async function startForeignModule(
  config: ForeignModuleConfig,
  scopeRoot: string,
  moduleConfig?: Record<string, unknown>,
): Promise<KotaModule> {
  const resolvedCwd = resolve(scopeRoot);

  if (config.transport === "stdio" && (config.maxRestarts ?? DEFAULT_MAX_RESTARTS) > 0) {
    return startResilientStdioModule(config, resolvedCwd, moduleConfig);
  }

  const transport: KempTransport =
    config.transport === "http"
      ? new HttpTransport(config)
      : new StdioTransport(config, resolvedCwd);
  const label = config.transport === "http" ? config.url : config.command;

  const raw = await createRawForeignModule(transport, label, resolvedCwd, moduleConfig);
  const tools = buildForeignToolDefs(raw.toolDefs, () => raw.session);

  return {
    name: raw.name,
    version: raw.version,
    description: raw.description,
    tools,
    healthCheck: () => raw.session.healthCheck(HEALTH_CHECK_TIMEOUT_MS),
    onLoad: () => ({ dispose: () => raw.session.close() }),
  };
}

export async function loadForeignModules(
  configs: ForeignModuleConfig[],
  scopeRoot: string,
  moduleConfigs?: Record<string, Record<string, unknown>>,
): Promise<KotaModule[]> {
  const results: KotaModule[] = [];
  for (const config of configs) {
    const label = config.transport === "http" ? config.url : config.command;
    try {
      const moduleConfig = moduleConfigs?.[label];
      const module = await startForeignModule(config, resolve(scopeRoot), moduleConfig);
      results.push(module);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printTerminalDiagnostic(`[kota] Foreign module "${label}" failed to start: ${msg}`, "error");
    }
  }
  return results;
}
