import type { KotaThinkingConfig } from "#core/agent-harness/message-protocol.js";
import type { ChannelUserIdentity } from "#core/channels/channel.js";
import { getEventBus, tryEmit } from "#core/events/event-bus.js";
import { runCleanupHooks } from "#core/loop/cleanup-hooks.js";
import { listManifestModules } from "#core/manifest/index.js";
import { McpManager } from "#core/mcp/manager.js";
import type { ModelClient } from "#core/model/model-client.js";
import type { ModelTiers } from "#core/model/model-router.js";
import { discoverModules } from "#core/modules/module-discovery.js";
import type { ModuleLoader } from "#core/modules/module-loader.js";
import { discoverProjectModules } from "#core/modules/project-discovery.js";
import { getHistoryProvider, resetProviderRegistry } from "#core/modules/provider-registry.js";
import { resetAgentStatusProviders } from "#core/tools/agent-status.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { loadSavedTools, resetCustomTools } from "#core/tools/custom-tool.js";
import { getDelegateConfig, setDelegateConfig } from "#core/tools/delegate-config.js";
import type { GuardrailsConfig } from "#core/tools/guardrails.js";
import { addLoadedModule, resetModuleFactory } from "#core/tools/module-factory/index.js";
import { resetGroups } from "#core/tools/tool-groups.js";
import { resetToolTelemetry } from "#core/tools/tool-telemetry.js";
import type { Context } from "./context.js";
import type { CostTracker } from "./cost.js";
import { resetChangeTracker } from "./file-changes.js";
import type { SessionStateMachine } from "./session-state.js";
import type { Transport } from "./transport.js";
import type { VerifyTracker } from "./verify-tracker.js";

/** Internal state interface used to access AgentSession fields from extracted functions. */
export interface AgentLoopState {
  initialized: boolean;
  initPromise: Promise<void>;
  sessionStartTime: number;
  sessionId: string;
  sessionLabel: string | undefined;
  context: Context;
  client: ModelClient;
  model: string;
  editorModel: string;
  maxTokens: number;
  effectiveMaxTokens: number;
  thinkingConfig: KotaThinkingConfig | undefined;
  verbose: boolean;
  transport: Transport;
  verifyTracker: VerifyTracker;
  mcpManager: McpManager | null;
  costTracker: CostTracker;
  reflectionEnabled: boolean;
  stateMachine: SessionStateMachine;
  guardrailsConfig: GuardrailsConfig;
  sessionPath: string | undefined;
  historyEnabled: boolean;
  historySource: "user" | "action";
  conversationId: string | null;
  /** Pending resume target captured from LoopOptions; consumed during module init. */
  resumeConversationId: string | undefined;
  projectContext: string;
  instructionContext: string;
  modelTiers: ModelTiers | undefined;
  channelIdentity: ChannelUserIdentity | undefined;
  autonomyMode: AutonomyMode;
  moduleLoader: ModuleLoader;
  closed: boolean;
  sigintHandler: () => void;
}

export async function runInitModules(state: AgentLoopState): Promise<void> {
  const config = McpManager.loadConfig();
  if (config) {
    state.mcpManager = new McpManager();
    await state.mcpManager.initialize(config);
    if (state.mcpManager.getToolCount() > 0) {
      // Preserve any harness name the loop constructor already wired in from
      // `config.defaultAgentHarness` — re-calling setDelegateConfig here must
      // not silently drop it.
      const previousHarness = getDelegateConfig().harness;
      setDelegateConfig({
        model: state.editorModel,
        modelTiers: state.modelTiers,
        client: state.client,
        cwd: process.cwd(),
        projectContext: state.projectContext || undefined,
        instructionContext: state.instructionContext || undefined,
        costTracker: state.costTracker,
        transport: state.transport,
        mcpManager: state.mcpManager,
        ...(previousHarness !== undefined ? { harness: previousHarness } : {}),
      });
      if (state.verbose) {
        state.transport.emit({
          type: "status",
          message: `[kota] MCP: ${state.mcpManager.getServerCount()} server(s), ${state.mcpManager.getToolCount()} tool(s)`,
        });
      }
    }
  }

  const projectModules = await discoverProjectModules();
  const modules = await discoverModules(undefined, state.verbose);
  for (const { name } of listManifestModules()) addLoadedModule(name);
  await state.moduleLoader.loadAll(projectModules, modules);

  restoreConversationIfRequested(state);

  const skillsPrompt = state.moduleLoader.getSkillsPrompt();
  if (skillsPrompt) {
    state.context.appendSystemPrompt(skillsPrompt);
  }

  const customToolCount = loadSavedTools();
  if (customToolCount > 0 && state.verbose) {
    state.transport.emit({ type: "status", message: `[kota] Loaded ${customToolCount} custom tool(s)` });
  }

  const bus = getEventBus();
  if (bus) state.moduleLoader.setBus(bus);

  state.initialized = true;
  if (state.stateMachine.canTransition("ready")) {
    state.stateMachine.transition("ready");
  }
}

function restoreConversationIfRequested(state: AgentLoopState): void {
  if (!state.resumeConversationId) return;
  const targetId = state.resumeConversationId;
  state.resumeConversationId = undefined;
  const history = getHistoryProvider();
  const data = history.load(targetId);
  if (data) {
    state.conversationId = targetId;
    state.context.restoreFrom(data.messages, data.compactionCount, data.lastInputTokens);
    state.transport.emit({
      type: "status",
      message: `[kota] Resumed conversation: "${data.record.title}" (${data.record.messageCount} messages)`,
    });
  } else {
    // Mirror the pre-refactor semantics: a session that binds history only
    // through resumeConversation (i.e. also has a sessionPath) disables
    // history when resume fails; a session without a sessionPath still
    // creates a new conversation on the next save.
    if (state.sessionPath) state.historyEnabled = false;
    state.transport.emit({
      type: "error",
      message: `[kota] Conversation ${targetId} not found, starting fresh`,
    });
  }
}

export function saveToHistoryImpl(state: AgentLoopState): void {
  if (!state.historyEnabled) return;
  const snapshot = state.context.snapshot();
  if (!state.conversationId && snapshot.messages.length === 0) return;
  let history: ReturnType<typeof getHistoryProvider>;
  try {
    history = getHistoryProvider();
  } catch {
    // History module not loaded (e.g. a deployment excludes it, or the
    // session closes before init completes). Saving is a best-effort side
    // effect — skip rather than surfacing an init error to the caller.
    return;
  }
  if (!state.conversationId) {
    state.conversationId = history.create(state.model, process.cwd(), state.historySource);
  }
  history.save(state.conversationId, snapshot.messages, snapshot.compactionCount, snapshot.lastInputTokens);
}

export function runClose(state: AgentLoopState, errored: boolean): void {
  if (state.closed) return;
  state.closed = true;
  if (errored && state.stateMachine.canTransition("error")) {
    state.stateMachine.transition("error");
  }
  if (state.stateMachine.canTransition("closed")) {
    state.stateMachine.transition("closed");
  }
  if (state.sessionPath) state.context.save(state.sessionPath);
  saveToHistoryImpl(state);
  runCleanupHooks();
  resetCustomTools();
  resetModuleFactory();
  resetChangeTracker();
  resetGroups();
  resetProviderRegistry();
  resetToolTelemetry();
  resetAgentStatusProviders();
  state.moduleLoader.unloadAll().catch(() => {});
  state.mcpManager?.close().catch(() => {});
  if (state.sessionStartTime > 0) {
    tryEmit("session.end", {
      sessionId: state.sessionId,
      label: state.sessionLabel,
      error: errored ? "session errored" : undefined,
      durationMs: Date.now() - state.sessionStartTime,
    });
  }
  if (!errored) {
    state.transport.emit({ type: "status", message: `[kota] Done — ${state.costTracker.getSummary()}` });
  }
}
