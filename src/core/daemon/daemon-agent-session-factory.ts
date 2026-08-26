import { AgentSession } from "#core/loop/loop.js";
import { NullTransport, type Transport } from "#core/loop/transport.js";
import type {
  CreateSessionOptions,
  ModuleSession,
} from "#core/modules/module-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { DaemonConfig } from "./daemon-config.js";
import type { ScopeRuntimeRegistry } from "./scope-runtime.js";

type DaemonAgentSessionOptions = CreateSessionOptions & {
  resumeConversation?: string;
};

export function createDaemonAgentSessionFactories(
  config: DaemonConfig,
  scopeRuntimes: ScopeRuntimeRegistry,
): {
  makeAgentSession: (
    transport: Transport,
    autonomyMode: AutonomyMode,
    scopeId: string,
    options?: DaemonAgentSessionOptions,
  ) => AgentSession;
  createModuleSession: (options: CreateSessionOptions) => ModuleSession;
} {
  const makeAgentSession = (
    transport: Transport,
    autonomyMode: AutonomyMode,
    scopeId: string,
    options: DaemonAgentSessionOptions = {},
  ): AgentSession => {
    const runtime = scopeRuntimes.get(scopeId);
    return new AgentSession({
      autonomyMode,
      model: options.model ?? config.model ?? config.config?.model,
      verbose: config.verbose,
      transport,
      config: config.config,
      resumeConversation: options.resumeConversation,
      label: options.label,
      noHistory: options.noHistory,
      historySource: options.historySource,
      reflectionEnabled: options.reflectionEnabled,
      scopeRoot: runtime.scope.scopeRoot,
      scopeRuntime: runtime,
      moduleLoader: config.runtimeModuleHost?.moduleLoader,
    });
  };

  return {
    makeAgentSession,
    createModuleSession: (options) => {
      const autonomyMode = options.autonomyMode
        ?? config.config?.serve?.defaultAutonomyMode;
      if (autonomyMode === undefined) {
        throw new Error(
          "Host-created module sessions require an explicit autonomyMode",
        );
      }
      return makeAgentSession(
        options.transport ?? new NullTransport(),
        autonomyMode,
        options.scopeId ?? scopeRuntimes.getDefaultScopeId(),
        options,
      );
    },
  };
}
