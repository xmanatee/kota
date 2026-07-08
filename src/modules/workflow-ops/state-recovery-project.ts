import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  normalizeScopeSelector,
  type ScopeSelector,
  selectedScopeSelectorId,
} from "#core/server/scope-selector.js";

export type WorkflowStateRecoveryProjectResolution =
  | { ok: true; projectDir: string; selectedId: string }
  | { ok: false; message: string };

export function resolveWorkflowStateRecoveryProject(
  ctx: Pick<ModuleContext, "cwd" | "getProvider">,
  selector?: ScopeSelector,
): WorkflowStateRecoveryProjectResolution {
  const normalized = normalizeScopeSelector(selector);
  const selectedId = selectedScopeSelectorId(normalized);
  if (!selectedId) {
    return {
      ok: true,
      projectDir: ctx.cwd,
      selectedId: deriveDirectoryScopeId(ctx.cwd),
    };
  }

  const scopeProvider = ctx.getProvider(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE);
  if (!scopeProvider) {
    const defaultId = deriveDirectoryScopeId(ctx.cwd);
    if (selectedId === defaultId) {
      return { ok: true, projectDir: ctx.cwd, selectedId };
    }
    return {
      ok: false,
      message: `Unknown project: ${selectedId}`,
    };
  }

  const resolved = scopeProvider.resolveProjectRuntime(selectedId);
  if (!resolved.ok) {
    return {
      ok: false,
      message: `Unknown project: ${selectedId}`,
    };
  }

  return {
    ok: true,
    projectDir: resolved.runtime.project.projectDir,
    selectedId: resolved.runtime.project.projectId,
  };
}
