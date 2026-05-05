import type { AgentDef } from "#core/agents/agent-types.js";
import type { ChannelDef } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import type { EventBus } from "#core/events/event-bus.js";
import { executeTool } from "#core/tools/index.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { createModuleContext, type ModuleContextParams } from "./module-context.js";
import type { ModuleStorage } from "./module-storage.js";
import type {
  ControlRouteRegistration,
  CreateSessionOptions,
  HealthCheckResult,
  ModuleRuntimeContext,
  ModuleSession,
  ModuleSummary,
  RouteRegistration,
} from "./module-types.js";

const MAX_TOOL_CALL_DEPTH = 10;

export interface LoaderContextDeps {
  cwd: string;
  verbose: boolean;
  config: KotaConfig;
  moduleStorages: Map<string, ModuleStorage>;
  getBus: () => EventBus | null;
  getRoutes: () => RouteRegistration[];
  getContributedControlRoutes: () => ControlRouteRegistration[];
  getContributedWorkflows: () => RegisteredWorkflowDefinitionInput[];
  getContributedChannels: () => ChannelDef[];
  getModuleSummaries: () => ModuleSummary[];
  resolveAgentDef: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt: (skillNames: string[] | "all", agentName?: string) => string;
  getSessionFactory: () => ((opts: CreateSessionOptions) => ModuleSession) | null;
  probeHealthChecks: () => Promise<Record<string, HealthCheckResult>>;
  getRegisteredConfigKeys: () => ReadonlySet<string>;
}

/**
 * Mutable counter shared across every context created by the loader so a tool
 * runner that calls another tool through `ctx.callTool` cannot recurse past
 * `MAX_TOOL_CALL_DEPTH`. The counter is the loader's per-load-cycle bookkeeping
 * the context closures read; it lives here because the tool-call-depth invariant
 * is part of the context construction phase, not the load orchestrator.
 */
export interface ToolCallDepth {
  value: number;
}

export function createLoaderModuleContext(
  deps: LoaderContextDeps,
  depth: ToolCallDepth,
  moduleName?: string,
): ModuleRuntimeContext {
  const params: ModuleContextParams = {
    cwd: deps.cwd,
    verbose: deps.verbose,
    config: deps.config,
    moduleStorages: deps.moduleStorages,
    getBus: deps.getBus,
    getRoutes: deps.getRoutes,
    getContributedControlRoutes: deps.getContributedControlRoutes,
    getContributedWorkflows: deps.getContributedWorkflows,
    getContributedChannels: deps.getContributedChannels,
    getModuleSummaries: deps.getModuleSummaries,
    resolveAgentDef: deps.resolveAgentDef,
    resolveSkillsPrompt: deps.resolveSkillsPrompt,
    sessionFactory: deps.getSessionFactory(),
    probeHealthChecks: deps.probeHealthChecks,
    getRegisteredConfigKeys: deps.getRegisteredConfigKeys,
    callTool: async (name, input) => {
      if (depth.value >= MAX_TOOL_CALL_DEPTH) {
        return {
          content: `Tool call depth limit exceeded (max ${MAX_TOOL_CALL_DEPTH})`,
          is_error: true,
        };
      }
      depth.value++;
      try {
        return await executeTool(name, input);
      } finally {
        depth.value--;
      }
    },
  };
  return createModuleContext(params, moduleName);
}
