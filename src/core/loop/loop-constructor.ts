import { existsSync } from "node:fs";
import { SYSTEM_PROMPT } from "#core/agents/system-prompt.js";
import { buildUserProfile } from "#core/config/config.js";
import { setApprovalQueueInstance } from "#core/daemon/approval-queue.js";
import { setOwnerQuestionQueueInstance } from "#core/daemon/owner-question-queue.js";
import { initScheduler, setSchedulerInstance } from "#core/daemon/scheduler.js";
import { initTaskStore, setTaskStoreInstance } from "#core/daemon/task-store.js";
import { tryEmit } from "#core/events/event-bus.js";
import { createModelClient } from "#core/model/model-client.js";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { initModuleLogStore, setModuleLogStoreInstance } from "#core/modules/module-log.js";
import type { CreateSessionOptions, ModuleSession } from "#core/modules/module-types.js";
import { initProviderRegistry, registerDefaultProviders } from "#core/modules/provider-registry.js";
import { setConfigProvider, setModuleInfoProvider } from "#core/tools/agent-status.js";
import { isAutonomyMode } from "#core/tools/autonomy-mode.js";
import { setDelegateConfig } from "#core/tools/delegate.js";
import {
  cloneGuardrailsConfig,
  createGuardrailsSnapshot,
  getDefaultConfig as getDefaultGuardrails,
} from "#core/tools/guardrails.js";
import { enableGroup } from "#core/tools/tool-groups.js";
import { buildSessionWarmup } from "#root/init.js";
import { Context } from "./context.js";
import { CostTracker } from "./cost.js";
import { initChangeTracker } from "./file-changes.js";
import { loadInstructionContext } from "./instruction-files.js";
import type { LoopOptions } from "./loop.js";
import { type AgentLoopState, runInitModules, saveToHistoryImpl } from "./loop-init.js";
import { loadProjectContext } from "./project-context.js";
import { SessionStateMachine } from "./session-state.js";
import { NullTransport, ProxyTransport } from "./transport.js";
import { detectVerifyCommands, VerifyTracker } from "./verify-tracker.js";

export function initAgentSession(
  state: AgentLoopState,
  options: LoopOptions,
  sessionFactory: (opts: CreateSessionOptions) => ModuleSession,
): void {
  const projectDir = options.projectRuntime?.project.projectDir ?? options.projectDir ?? process.cwd();
  state.projectDir = projectDir;
  state.sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  state.sessionLabel = options.label;
  if (!isAutonomyMode(options.autonomyMode)) {
    throw new Error(
      "AgentSession requires an explicit autonomyMode (passive | supervised | autonomous)",
    );
  }
  state.autonomyMode = options.autonomyMode;
  state.mcpInputResolver = options.mcpInputResolver;
  state.mcpAuthorizationResolver = options.mcpAuthorizationResolver;
  state.mcpServers = options.mcpServers;
  state.clientApprovalResolver = options.clientApprovalResolver;
  state.model =
    options.model || resolveActivePresetFromConfig(options.config).defaultModel;
  state.editorModel = options.editorModel || state.model;
  state.maxTokens = options.maxTokens || 8192;
  state.verbose = options.verbose || false;
  state.sessionPath = options.sessionPath;
  const showCost = options.showCost ?? options.config?.serve?.showCost ?? true;
  state.showCost = showCost;
  if (options.transport) {
    state.transport = options.transport;
    state.defaultTransportProxy = undefined;
  } else {
    // The rendering module contributes the default CLI transport through
    // the provider registry during its `onLoad`. That runs inside
    // `runInitModules`, after the constructor finishes, so we start with
    // a proxy wrapping `NullTransport` and swap its target once the
    // rendering provider is available. Deployments that omit the
    // rendering module keep the `NullTransport` fallback.
    const proxy = new ProxyTransport(new NullTransport());
    state.defaultTransportProxy = proxy;
    state.transport = proxy;
  }
  const isNonInteractive = options.historySource === "action";
  const initialGuardrailsConfig = options.config?.guardrails
    ?? (isNonInteractive ? { policies: { safe: "allow", moderate: "allow", dangerous: "deny" } } : getDefaultGuardrails());
  state.guardrailsConfig = cloneGuardrailsConfig(initialGuardrailsConfig);
  state.guardrailsSnapshot = createGuardrailsSnapshot(state.guardrailsConfig, 0);
  state.reflectionEnabled = options.reflectionEnabled ?? options.config?.reflection ?? true;
  state.modelTiers = options.config?.modelTiers;
  state.modelOutputTokenLimits = options.config?.modelOutputTokenLimits;
  state.channelIdentity = options.channelIdentity;

  const thinkingBudget = options.thinkingBudget || 10_000;
  state.thinkingConfig = options.thinkingEnabled
    ? { type: "enabled", budget_tokens: thinkingBudget }
    : undefined;
  state.effectiveMaxTokens = options.thinkingEnabled
    ? thinkingBudget + state.maxTokens
    : state.maxTokens;

  state.client = options.client ?? createModelClient({
    model: state.model,
    projectDir,
  }).client;
  state.costTracker = new CostTracker();

  if (options.projectRuntime) {
    if (options.projectDir !== undefined && options.projectDir !== projectDir) {
      throw new Error(
        `AgentSession projectDir ${options.projectDir} does not match projectRuntime ${projectDir}`,
      );
    }
    setTaskStoreInstance(options.projectRuntime.taskStore);
    setSchedulerInstance(options.projectRuntime.scheduler);
    setModuleLogStoreInstance(options.projectRuntime.moduleLogStore);
    setApprovalQueueInstance(options.projectRuntime.approvalQueue);
    setOwnerQuestionQueueInstance(options.projectRuntime.ownerQuestionQueue);
  } else {
    initTaskStore(projectDir);
    initScheduler(projectDir);
    initModuleLogStore(projectDir);
  }
  initChangeTracker();
  initProviderRegistry();
  registerDefaultProviders();

  state.projectContext = loadProjectContext(projectDir, projectDir);
  const projectContext = state.projectContext;
  const instructionContext = loadInstructionContext(projectDir, projectDir);
  state.instructionContext = instructionContext;
  const warmup = buildSessionWarmup(projectDir);
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

  if (state.sessionPath && existsSync(state.sessionPath) && !options.resumeConversation) {
    state.context = Context.load(state.sessionPath, systemPrompt);
    if (state.verbose) state.transport.emit({ type: "status", message: `[kota] Resumed session from ${state.sessionPath}` });
  } else {
    state.context = new Context(systemPrompt);
  }

  // Conversation resume needs the history provider, which the history module
  // registers during runInitModules. Defer the actual restore to that phase;
  // keep the intent on state so the async init can consume it.
  state.resumeConversationId = options.resumeConversation;
  state.historyEnabled = !options.noHistory && (!state.sessionPath || !!options.resumeConversation);
  state.historySource = options.historySource ?? "user";

  state.verifyTracker = new VerifyTracker(detectVerifyCommands(projectDir));

  const activePreset = resolveActivePresetFromConfig(options.config);
  setDelegateConfig({
    model: state.editorModel,
    modelTiers: options.config?.modelTiers,
    modelOutputTokenLimits: options.config?.modelOutputTokenLimits,
    client: state.client,
    cwd: projectDir,
    projectContext: projectContext || undefined,
    instructionContext: instructionContext || undefined,
    costTracker: state.costTracker,
    transport: state.transport,
    harness: options.config?.defaultAgentHarness ?? activePreset.harness,
  });

  state.moduleLoader = new ModuleLoader(options.config || {}, state.verbose);
  state.moduleLoader.setCwd(projectDir);
  setModuleInfoProvider(() =>
    state.moduleLoader.getLoadedModules().map((name) => ({
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
  state.moduleLoader.setSessionFactory(sessionFactory);

  state.stateMachine = new SessionStateMachine();
  state.stateMachine.onChange((from, to, meta) => {
    state.transport.emit({ type: "state_change", from, to, meta });
    tryEmit("session.state", { sessionId: state.sessionId, from, to, meta });
  });
  state.stateMachine.transition("initializing");
  state.initPromise = runInitModules(state);

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
