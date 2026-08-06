import { join } from "node:path";
import { loadConfig } from "#core/config/config.js";
import { deriveDirectoryScopeId, loadRegistryFileFromDisk } from "#core/daemon/scope-registry.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";
import { validateWorkflowDefinitions, WorkflowDefinitionError } from "#core/workflow/validation.js";
import type { WorkflowTrialOptions, WorkflowTrialResult } from "../client.js";
import type {
  TrialProjectResolution,
  WorkflowTrialRuntimeFactory,
} from "./trial-internal-types.js";
import { WorkflowTrialRequestError } from "./trial-internal-types.js";
import { runWorkflowTrial } from "./trial-runner.js";

export function createDefaultWorkflowTrialRuntimeFactory(): WorkflowTrialRuntimeFactory {
  return async (trialProjectDir: string, sourceProjectDir = trialProjectDir) => {
    const runtimeConfig = loadConfig(sourceProjectDir);
    const runtimeLoader = await loadRuntimeModules({
      config: runtimeConfig,
      cwd: trialProjectDir,
      installedModuleSourceDir: sourceProjectDir,
    });
    try {
      const runtime = resolveAgentRuntime(runtimeConfig);
      const definitions = validateWorkflowDefinitions(
        runtimeLoader.getContributedWorkflows(),
        trialProjectDir,
        {
          defaultAgentHarness: runtime.harness,
          preset: runtime.preset,
          modelTiers: runtime.tiers,
          agentModels: runtimeConfig.agentModels,
          resolveAgentDef: (name) => runtimeLoader.getAgentDef(name),
        },
      );
      return {
        config: runtimeConfig,
        definitions,
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

function resolveWorkflowTrialProject(
  ctx: ModuleContext,
  options: WorkflowTrialOptions | undefined,
): TrialProjectResolution {
  const requestedProjectId = options?.projectId;
  const defaultProjectId = deriveDirectoryScopeId(ctx.cwd);
  if (requestedProjectId === undefined || requestedProjectId === defaultProjectId) {
    return {
      ok: true,
      sourceProjectDir: ctx.cwd,
      projectId: defaultProjectId,
    };
  }
  const registry = loadRegistryFileFromDisk(join(ctx.cwd, ".kota"));
  const project = registry?.projects.find((entry) => entry.projectId === requestedProjectId);
  if (!project) {
    return {
      ok: false,
      projectId: requestedProjectId,
      message: `Unknown project: ${requestedProjectId}`,
    };
  }
  return {
    ok: true,
    sourceProjectDir: project.projectDir,
    projectId: project.projectId,
  };
}

export async function runLocalWorkflowTrial(
  ctx: ModuleContext,
  name: string,
  options?: WorkflowTrialOptions,
): Promise<WorkflowTrialResult> {
  try {
    const project = resolveWorkflowTrialProject(ctx, options);
    if (!project.ok) {
      return { ok: false, reason: "unknown_project", message: project.message };
    }
    const summary = await runWorkflowTrial({
      sourceProjectDir: project.sourceProjectDir,
      workflowName: name,
      options: { ...(options ?? {}), projectId: project.projectId },
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
