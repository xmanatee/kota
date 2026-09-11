import type { DaemonRuntimeScopeProvider } from "#core/daemon/runtime-scope-provider.js";
import { resolveLiveDirectoryScope } from "#core/daemon/scope-directory.js";
import { ModuleLogStore } from "./module-log.js";

type ModuleLogScope = {
  scopeId?: string;
  scopeRoot?: string;
  resolveRuntimeScope?: DaemonRuntimeScopeProvider["resolve"];
};

/** Runtime ownership wins; standalone callers must supply a canonical scope root. */
export function resolveModuleLogStore(scope: ModuleLogScope):
  | { ok: true; store: ModuleLogStore }
  | { ok: false; error: string } {
  const directory = scope.scopeRoot === undefined
    ? undefined
    : resolveLiveDirectoryScope({ scopeRoot: scope.scopeRoot });
  if (directory && !directory.ok) {
    return { ok: false, error: `Module log scope is unavailable: ${directory.message}` };
  }
  const canonical = directory?.scope;
  const scopeId = scope.scopeId ?? canonical?.scopeId;
  if (!scopeId) return { ok: false, error: "Module logs require an authoritative scope" };
  if (scope.resolveRuntimeScope) {
    const resolved = scope.resolveRuntimeScope(scopeId);
    if (!resolved.ok) return { ok: false, error: `Module log scope ${scopeId} is unavailable` };
    if (canonical && canonical.scopeRoot !== resolved.runtime.scope.scopeRoot) {
      return { ok: false, error: `Module log scope ${scopeId} does not match canonical scopeRoot` };
    }
    return { ok: true, store: resolved.runtime.moduleLogStore };
  }
  if (!canonical || canonical.scopeId !== scopeId) {
    return { ok: false, error: `Module log scope ${scopeId} has no authoritative runtime or canonical scopeRoot` };
  }
  return { ok: true, store: new ModuleLogStore(canonical.scopeRoot) };
}
