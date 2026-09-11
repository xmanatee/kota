import type { AgentDef } from "#core/agents/agent-types.js";
import type { ChannelDef } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import type { EventBus } from "#core/events/event-bus.js";
import { executeNestedTool } from "#core/tools/tool-runner-execution.js";
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
import type { RegisteredUiSurfaceSource } from "./module-ui-surfaces.js";
import type { ProviderRegistry } from "./provider-registry.js";

export interface LoaderContextDeps {
  cwd: string;
  scopeRoot?: string;
  verbose: boolean;
  config: KotaConfig;
  moduleStorages: Map<string, ModuleStorage>;
  getBus: () => EventBus | null;
  trackEventSubscription: (unsubscribe: () => void) => () => void;
  trackRegistration: (dispose: () => void) => void;
  getRoutes: () => RouteRegistration[];
  getContributedControlRoutes: () => ControlRouteRegistration[];
  getContributedWorkflows: () => RegisteredWorkflowDefinitionInput[];
  getContributedChannels: () => ChannelDef[];
  getContributedUiSurfaces: () => RegisteredUiSurfaceSource[];
  getModuleSummaries: () => ModuleSummary[];
  resolveAgentDef: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt: (skillNames: string[] | "all", agentName?: string) => string;
  getSessionFactory: () => ((opts: CreateSessionOptions) => ModuleSession) | null;
  probeHealthChecks: () => Promise<Record<string, HealthCheckResult>>;
  getRegisteredConfigKeys: () => ReadonlySet<string>;
  providerRegistry: ProviderRegistry;
}

export function createLoaderModuleContext(
  deps: LoaderContextDeps,
  moduleName?: string,
): ModuleRuntimeContext {
  const params: ModuleContextParams = {
    cwd: deps.cwd,
    scopeRoot: deps.scopeRoot,
    verbose: deps.verbose,
    config: deps.config,
    moduleStorages: deps.moduleStorages,
    getBus: deps.getBus,
    trackEventSubscription: deps.trackEventSubscription,
    trackRegistration: deps.trackRegistration,
    getRoutes: deps.getRoutes,
    getContributedControlRoutes: deps.getContributedControlRoutes,
    getContributedWorkflows: deps.getContributedWorkflows,
    getContributedChannels: deps.getContributedChannels,
    getContributedUiSurfaces: deps.getContributedUiSurfaces,
    getModuleSummaries: deps.getModuleSummaries,
    resolveAgentDef: deps.resolveAgentDef,
    resolveSkillsPrompt: deps.resolveSkillsPrompt,
    getSessionFactory: deps.getSessionFactory,
    probeHealthChecks: deps.probeHealthChecks,
    getRegisteredConfigKeys: deps.getRegisteredConfigKeys,
    providerRegistry: deps.providerRegistry,
    callTool: executeNestedTool,
  };
  return createModuleContext(params, moduleName);
}
