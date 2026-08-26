import type { PostRunHook, PreRunHook } from "#core/agent-harness/hooks.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { ChannelDef } from "#core/channels/channel.js";
import type { KotaConfig } from "#core/config/config.js";
import type { DynamicStateContext } from "#core/loop/dynamic-state.js";
import type { PreSendHook } from "#core/loop/pre-send-hooks.js";
import type { ToolMiddlewareFn } from "#core/tools/tool-middleware.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinitionInput,
} from "#core/workflow/types.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import type { ModuleStorage } from "./module-storage.js";
import type {
  ControlRouteRegistration,
  CreateSessionOptions,
  HealthCheckResult,
  ModuleBoundaryRecord,
  ModuleEventProxy,
  ModuleLogger,
  ModuleSession,
  ModuleSummary,
  RouteRegistration,
} from "./module-types.js";
import type { RegisteredUiSurfaceSource } from "./module-ui-surfaces.js";
import type { ProviderToken } from "./provider-token.js";

export type ModuleContribution<T> =
  | readonly T[]
  | ((ctx: ModuleContext) => readonly T[] | Promise<readonly T[]>);

export type ModuleWorkflowContribution =
  | WorkflowDefinitionInput
  | RegisteredWorkflowDefinitionInput;

export type ModuleBaseContext = {
  cwd: string;
  verbose: boolean;
  config: KotaConfig;
  storage: ModuleStorage;
  log: ModuleLogger;
  getSecret: (key: string) => string | null;
  getModuleConfig: <T = ModuleBoundaryRecord>() => T | undefined;
  getRegisteredConfigKeys: () => ReadonlySet<string>;
};

export type ModuleInspectionContext = {
  getRoutes: () => RouteRegistration[];
  getContributedControlRoutes: () => ControlRouteRegistration[];
  getContributedWorkflows: () => RegisteredWorkflowDefinitionInput[];
  getContributedChannels: () => ChannelDef[];
  getContributedUiSurfaces: () => RegisteredUiSurfaceSource[];
  getModuleSummaries: () => ModuleSummary[];
  resolveAgentDef: (name: string) => AgentDef | undefined;
  resolveSkillsPrompt: (skillNames: string[] | "all", agentName?: string) => string;
  probeHealthChecks: () => Promise<Record<string, HealthCheckResult>>;
};

export type ToolInvocationContext = {
  callTool: (name: string, input: ModuleBoundaryRecord) => Promise<ToolResult>;
  listTools: () => string[];
};

export type ModuleEventContext = { events: ModuleEventProxy };

export type ProviderLookupContext = {
  getProvider: <T>(token: ProviderToken<T>) => T | null;
  listProviders?: <T>(token: ProviderToken<T>) => readonly T[];
};

export type ModuleSessionContext = {
  createSession: (options?: CreateSessionOptions) => ModuleSession;
};

export type ModuleClientContext = { readonly client: KotaClient };

export type ProviderRegistrationContext = {
  registerProvider: <T>(token: ProviderToken<T>, provider: T) => void;
};

export type ToolRegistrationContext = {
  registerGroup: (name: string, toolNames: string[], pattern?: RegExp) => void;
  registerMiddleware: (name: string, fn: ToolMiddlewareFn, priority?: number) => void;
};

export type LoopDecorationContext = {
  registerDynamicStateProvider: (
    name: string,
    fn: (ctx: DynamicStateContext) => string,
  ) => void;
  registerCleanupHook: (fn: () => void) => void;
  registerPreSendHook: (name: string, fn: PreSendHook) => void;
  registerHarnessHook: (
    registration:
      | { kind: "preRun"; name: string; handler: PreRunHook }
      | { kind: "postRun"; name: string; handler: PostRunHook },
  ) => void;
};

export type ModuleContext =
  & ModuleBaseContext
  & ModuleInspectionContext
  & ToolInvocationContext
  & ModuleEventContext
  & ProviderLookupContext
  & ModuleSessionContext
  & ModuleClientContext;

export type ModuleRuntimeContext =
  & ModuleContext
  & ProviderRegistrationContext
  & ToolRegistrationContext
  & LoopDecorationContext;
