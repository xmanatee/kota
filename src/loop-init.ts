import type Anthropic from "@anthropic-ai/sdk";
import type { Context } from "./context.js";
import type { CostTracker } from "./cost.js";
import { getEventBus, tryEmit } from "./event-bus.js";
import { discoverExtensions } from "./extension-discovery.js";
import type { ExtensionLoader } from "./extension-loader.js";
import { resetChangeTracker } from "./file-changes.js";
import type { GuardrailsConfig } from "./guardrails.js";
import { resetAuditStore } from "./guardrails-audit.js";
import { listManifestModules } from "./manifest/index.js";
import { McpManager } from "./mcp/manager.js";
import { getHistory } from "./memory/history.js";
import type { ModelClient } from "./model/model-client.js";
import type { ModelTiers } from "./model/model-router.js";
import { builtinExtensions } from "./modules/index.js";
import { resetProviderRegistry } from "./providers.js";
import type { SessionStateMachine } from "./session-state.js";
import { resetGroups } from "./tool-groups.js";
import { resetToolTelemetry } from "./tool-telemetry.js";
import { resetAgentStatusProviders } from "./tools/agent-status.js";
import { cleanupSessions } from "./tools/code-exec.js";
import { loadSavedTools, resetCustomTools } from "./tools/custom-tool.js";
import { setDelegateConfig } from "./tools/delegate.js";
import { markModuleLoaded, resetModuleFactory } from "./tools/module-factory/index.js";
import { cleanupProcesses } from "./tools/process.js";
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
  architectMode: boolean;
  client: ModelClient;
  model: string;
  editorModel: string;
  maxTokens: number;
  effectiveMaxTokens: number;
  thinkingConfig: Anthropic.Messages.ThinkingConfigParam | undefined;
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
  projectContext: string;
  instructionContext: string;
  modelTiers: ModelTiers | undefined;
  moduleLoader: ExtensionLoader;
  closed: boolean;
}

export async function runInitExtensions(state: AgentLoopState): Promise<void> {
  const config = McpManager.loadConfig();
  if (config) {
    state.mcpManager = new McpManager();
    await state.mcpManager.initialize(config);
    if (state.mcpManager.getToolCount() > 0) {
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
      });
      if (state.verbose) {
        state.transport.emit({
          type: "status",
          message: `[kota] MCP: ${state.mcpManager.getServerCount()} server(s), ${state.mcpManager.getToolCount()} tool(s)`,
        });
      }
    }
  }

  const pluginModules = await discoverExtensions(undefined, state.verbose);
  for (const { name } of listManifestModules()) markModuleLoaded(name);
  await state.moduleLoader.loadAll([...builtinExtensions, ...pluginModules]);

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

export function saveToHistoryImpl(state: AgentLoopState): void {
  if (!state.historyEnabled) return;
  const snapshot = state.context.snapshot();
  const history = getHistory();
  if (!state.conversationId) {
    if (snapshot.messages.length === 0) return;
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
  cleanupProcesses();
  cleanupSessions();
  resetCustomTools();
  resetModuleFactory();
  resetChangeTracker();
  resetGroups();
  resetProviderRegistry();
  resetToolTelemetry();
  resetAuditStore();
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
