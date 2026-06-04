import type { Command } from "commander";
import type { AgentDef, SkillDef } from "#core/agents/agent-types.js";
import type { ChannelDef } from "#core/channels/channel.js";
import type { LocalClientHandlers } from "#core/server/kota-client.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import type { ModuleLoadFailure } from "./module-lifecycle.js";
import type { DaemonClientFactoryEntry } from "./module-loader-clients.js";
import type { ModuleStorage } from "./module-storage.js";
import type {
  ControlRouteRegistration,
  KotaModule,
  ModuleSource,
  RouteRegistration,
} from "./module-types.js";
import type { ModuleSetupRequirementContribution } from "./setup-requirements.js";

/**
 * Single mutable state object the loader, load-phase functions, lifecycle
 * functions, and read accessors all share. Splitting this into per-phase
 * shapes would force the orchestrator to translate between near-identical
 * map sets on every load-time call; one shape keeps the seam honest.
 */
export interface LoaderState {
  modules: KotaModule[];
  moduleStorages: Map<string, ModuleStorage>;
  moduleRegistry: Map<string, KotaModule>;
  moduleToolCounts: Map<string, number>;
  moduleWorkflowDefs: Map<string, readonly RegisteredWorkflowDefinitionInput[]>;
  moduleChannelDefs: Map<string, readonly ChannelDef[]>;
  moduleSkillDefs: Map<string, readonly SkillDef[]>;
  moduleAgentDefs: Map<string, readonly AgentDef[]>;
  moduleSetupRequirementDefs: Map<string, readonly ModuleSetupRequirementContribution[]>;
  moduleRoutes: Map<string, RouteRegistration[]>;
  moduleCommands: Map<string, Command[]>;
  moduleControlRoutes: Map<string, ControlRouteRegistration[]>;
  moduleRouteErrors: Map<string, string>;
  moduleCommandErrors: Map<string, string>;
  moduleControlRouteErrors: Map<string, string>;
  registeredConfigKeys: Map<string, string>;
  moduleSources: Map<string, ModuleSource>;
  skillContentsByName: Map<string, string>;
  skillDefsByName: Map<string, SkillDef>;
  importedSkillNames: Set<string>;
  explicitOnlySkillNames: Set<string>;
  contributedWorkflows: RegisteredWorkflowDefinitionInput[];
  contributedChannels: ChannelDef[];
  loadFailures: Map<string, ModuleLoadFailure>;
  localClientHandlers: Partial<LocalClientHandlers>;
  daemonClientFactories: DaemonClientFactoryEntry[];
}

export function createLoaderState(): LoaderState {
  return {
    modules: [],
    moduleStorages: new Map(),
    moduleRegistry: new Map(),
    moduleToolCounts: new Map(),
    moduleWorkflowDefs: new Map(),
    moduleChannelDefs: new Map(),
    moduleSkillDefs: new Map(),
    moduleAgentDefs: new Map(),
    moduleSetupRequirementDefs: new Map(),
    moduleRoutes: new Map(),
    moduleCommands: new Map(),
    moduleControlRoutes: new Map(),
    moduleRouteErrors: new Map(),
    moduleCommandErrors: new Map(),
    moduleControlRouteErrors: new Map(),
    registeredConfigKeys: new Map(),
    moduleSources: new Map(),
    skillContentsByName: new Map(),
    skillDefsByName: new Map(),
    importedSkillNames: new Set(),
    explicitOnlySkillNames: new Set(),
    contributedWorkflows: [],
    contributedChannels: [],
    loadFailures: new Map(),
    localClientHandlers: {},
    daemonClientFactories: [],
  };
}
