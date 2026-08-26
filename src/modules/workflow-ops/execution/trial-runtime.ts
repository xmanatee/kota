import { join } from "node:path";
import { loadConfig } from "#core/config/config.js";
import { deriveDirectoryScopeId, loadRegistryFileFromDisk } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import { WorkflowDefinitionError } from "#core/workflow/validation.js";
import type { WorkflowTrialOptions, WorkflowTrialResult } from "../client.js";
import type {
  TrialScopeResolution,
  WorkflowTrialRuntimeFactory,
} from "./trial-internal-types.js";
import { WorkflowTrialRequestError } from "./trial-internal-types.js";
import { runWorkflowTrial } from "./trial-runner.js";

export function createDefaultWorkflowTrialRuntimeFactory(): WorkflowTrialRuntimeFactory {
  return async (trialWorkspaceRoot: string, sourceScopeRoot = trialWorkspaceRoot) => {
    const runtimeConfig = loadConfig(sourceScopeRoot);
    const eventBus = new EventBus();
    const runtimeLoader = await loadRuntimeModules({
      config: runtimeConfig,
      cwd: trialWorkspaceRoot,
      installedModuleSourceDir: sourceScopeRoot,
      eventBus,
    });
    try {
      return {
        config: runtimeConfig,
        eventBus,
        providerRegistry: runtimeLoader.getProviderRegistry(),
        workflows: runtimeLoader.getContributedWorkflows(),
        resolveAgentDef: (name) => runtimeLoader.getAgentDef(name),
        resolveSkillsPrompt: (names, agentName) =>
          runtimeLoader.getSkillsPromptFor(names, agentName),
        unload: () => runtimeLoader.unloadAll(),
      };
    } catch (err) {
      await runtimeLoader.unloadAll();
      throw err;
    }
  };
}

function resolveWorkflowTrialScope(
  ctx: ModuleContext,
  options: WorkflowTrialOptions | undefined,
): TrialScopeResolution {
  const requestedScopeId = options?.scopeId;
  const defaultScopeId = deriveDirectoryScopeId(ctx.cwd);
  if (requestedScopeId === undefined || requestedScopeId === defaultScopeId) {
    return {
      ok: true,
      sourceScopeRoot: ctx.cwd,
      scopeId: defaultScopeId,
    };
  }
  const registry = loadRegistryFileFromDisk(join(ctx.cwd, ".kota"));
  const scope = registry?.scopes.find((entry) => entry.scopeId === requestedScopeId);
  if (!scope) {
    return {
      ok: false,
      scopeId: requestedScopeId,
      message: `Unknown scope: ${requestedScopeId}`,
    };
  }
  return {
    ok: true,
    sourceScopeRoot: scope.scopeRoot,
    scopeId: scope.scopeId,
  };
}

export async function runLocalWorkflowTrial(
  ctx: ModuleContext,
  name: string,
  options?: WorkflowTrialOptions,
): Promise<WorkflowTrialResult> {
  try {
    const scope = resolveWorkflowTrialScope(ctx, options);
    if (!scope.ok) {
      return { ok: false, reason: "unknown_scope", message: scope.message };
    }
    const summary = await runWorkflowTrial({
      sourceScopeRoot: scope.sourceScopeRoot,
      workflowName: name,
      options: { ...(options ?? {}), scopeId: scope.scopeId },
      runtimeFactory: createDefaultWorkflowTrialRuntimeFactory(),
    });
    return { ok: true, summary };
  } catch (err) {
    if (err instanceof WorkflowDefinitionError) {
      return {
        ok: false,
        reason: "invalid_request",
        message: `Definition error: ${err.message}`,
      };
    }
    if (err instanceof WorkflowTrialRequestError) {
      return { ok: false, reason: err.reason, message: err.message };
    }
    return {
      ok: false,
      reason: "invalid_request",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
