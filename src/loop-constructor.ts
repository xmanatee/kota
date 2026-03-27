import { existsSync } from "node:fs";
import { buildUserProfile } from "./config.js";
import { Context } from "./context.js";
import { CostTracker } from "./cost.js";
import { tryEmit } from "./event-bus.js";
import { ExtensionLoader } from "./extension-loader.js";
import { initModuleLogStore } from "./extension-log.js";
import type { CreateSessionOptions, ExtensionSession } from "./extension-types.js";
import { initChangeTracker } from "./file-changes.js";
import { getDefaultConfig as getDefaultGuardrails } from "./guardrails.js";
import { initAuditStore } from "./guardrails-audit.js";
import { buildSessionWarmup } from "./init.js";
import { loadInstructionContext } from "./instruction-files.js";
import type { LoopOptions } from "./loop.js";
import { type AgentLoopState, runInitExtensions, saveToHistoryImpl } from "./loop-init.js";
import { getHistory } from "./memory/history.js";
import { AnthropicModelClient } from "./model/model-client.js";
import { loadProjectContext } from "./project-context.js";
import { initProviderRegistry, registerDefaultProviders } from "./providers.js";
import { initScheduler } from "./scheduler/scheduler.js";
import { initTaskStore } from "./scheduler/task-store.js";
import { SessionStateMachine } from "./session-state.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { enableGroup } from "./tool-groups.js";
import { setConfigProvider, setModuleInfoProvider } from "./tools/agent-status.js";
import { setDelegateConfig } from "./tools/delegate.js";
import { CliTransport } from "./transport.js";
import { detectVerifyCommands, VerifyTracker } from "./verify-tracker.js";

export function initAgentSession(
  state: AgentLoopState,
  options: LoopOptions,
  sessionFactory: (opts: CreateSessionOptions) => ExtensionSession,
): void {
  state.sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  state.sessionLabel = options.label;
  state.model = options.model || "claude-sonnet-4-6";
  state.editorModel = options.editorModel || state.model;
  state.maxTokens = options.maxTokens || 8192;
  state.verbose = options.verbose || false;
  state.architectMode = options.architectMode || false;
  state.sessionPath = options.sessionPath;
  state.transport = options.transport || new CliTransport(state.verbose);
  const isNonInteractive = options.historySource === "action";
  state.guardrailsConfig = options.config?.guardrails
    ?? (isNonInteractive ? { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } } : getDefaultGuardrails());
  state.reflectionEnabled = options.reflectionEnabled ?? options.config?.reflection ?? true;
  state.modelTiers = options.config?.modelTiers;

  const thinkingBudget = options.thinkingBudget || 10_000;
  state.thinkingConfig = options.thinkingEnabled
    ? { type: "enabled", budget_tokens: thinkingBudget }
    : undefined;
  state.effectiveMaxTokens = options.thinkingEnabled
    ? thinkingBudget + state.maxTokens
    : state.maxTokens;

  state.client = options.client ?? new AnthropicModelClient({ maxRetries: 5 });
  state.costTracker = new CostTracker();

  initTaskStore(process.cwd());
  initScheduler(process.cwd());
  initModuleLogStore(process.cwd());
  initAuditStore(process.cwd());
  initChangeTracker();
  initProviderRegistry();
  registerDefaultProviders();

  state.projectContext = loadProjectContext(process.cwd(), process.cwd());
  const projectContext = state.projectContext;
  const instructionContext = loadInstructionContext(process.cwd(), process.cwd());
  state.instructionContext = instructionContext;
  const warmup = buildSessionWarmup();
  const userProfile = options.config ? buildUserProfile(options.config) : "";
  const systemPrompt = SYSTEM_PROMPT + projectContext + instructionContext + userProfile + warmup;
  if (projectContext && state.verbose) {
    state.transport.emit({ type: "status", message: "[kota] Loaded project context from .kota.md" });
  }
  if (instructionContext && state.verbose) {
    state.transport.emit({
      type: "status",
      message: "[kota] Loaded repo-local instructions from AGENTS.md / CLAUDE.md",
    });
  }
  if (userProfile && state.verbose) {
    state.transport.emit({ type: "status", message: "[kota] User profile loaded from config" });
  }
  if (warmup && state.verbose) {
    state.transport.emit({ type: "status", message: "[kota] Session warmup loaded" });
  }

  if (options.config?.autoEnable) {
    for (const group of options.config.autoEnable) {
      enableGroup(group);
    }
    if (state.verbose) {
      state.transport.emit({
        type: "status",
        message: `[kota] Auto-enabled tool groups: ${options.config.autoEnable.join(", ")}`,
      });
    }
  }

  if (options.resumeConversation) {
    const history = getHistory();
    const data = history.load(options.resumeConversation);
    if (data) {
      state.conversationId = options.resumeConversation;
      state.context = new Context(systemPrompt);
      state.context.restoreFrom(data.messages, data.compactionCount, data.lastInputTokens);
      state.transport.emit({
        type: "status",
        message: `[kota] Resumed conversation: "${data.record.title}" (${data.record.messageCount} messages)`,
      });
    } else {
      state.context = new Context(systemPrompt);
      state.transport.emit({ type: "error", message: `[kota] Conversation ${options.resumeConversation} not found, starting fresh` });
    }
  } else if (state.sessionPath && existsSync(state.sessionPath)) {
    state.context = Context.load(state.sessionPath, systemPrompt);
    if (state.verbose) state.transport.emit({ type: "status", message: `[kota] Resumed session from ${state.sessionPath}` });
  } else {
    state.context = new Context(systemPrompt);
  }

  state.historyEnabled = !options.noHistory && (!state.sessionPath || !!state.conversationId);
  state.historySource = options.historySource ?? "user";

  state.verifyTracker = new VerifyTracker(detectVerifyCommands());

  setDelegateConfig({
    model: state.editorModel,
    modelTiers: options.config?.modelTiers,
    client: state.client,
    cwd: process.cwd(),
    projectContext: projectContext || undefined,
    instructionContext: instructionContext || undefined,
    costTracker: state.costTracker,
    transport: state.transport,
  });

  state.extensionLoader = new ExtensionLoader(options.config || {}, state.verbose);
  setModuleInfoProvider(() =>
    state.extensionLoader.getLoadedExtensions().map((name) => ({
      name,
      toolCount: 0,
    })),
  );
  if (options.config) {
    const cfg = options.config;
    setConfigProvider(() => {
      const { modelProvider, ...safe } = cfg;
      return {
        ...safe,
        modelProvider: modelProvider
          ? { type: modelProvider.type, baseUrl: modelProvider.baseUrl }
          : undefined,
      };
    });
  }
  state.extensionLoader.setSessionFactory(sessionFactory);

  state.stateMachine = new SessionStateMachine();
  state.stateMachine.onChange((from, to, meta) => {
    state.transport.emit({ type: "state_change", from, to, meta });
    tryEmit("session.state", { sessionId: state.sessionId, from, to, meta });
  });
  state.stateMachine.transition("initializing");
  state.initPromise = runInitExtensions(state);

  state.sigintHandler = () => {
    if (state.sessionPath) {
      state.context.save(state.sessionPath);
      state.transport.emit({ type: "status", message: `\n[kota] Session saved to ${state.sessionPath}` });
    }
    saveToHistoryImpl(state);
    process.exit(0);
  };
  process.on("SIGINT", state.sigintHandler);
}
