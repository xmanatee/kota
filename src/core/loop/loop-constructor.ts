import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { requireAgentConversation } from "#core/agent-harness/session-continuity.js";
import { SYSTEM_PROMPT } from "#core/agents/system-prompt.js";
import { buildUserProfile, getGlobalConfigPath } from "#core/config/config.js";
import { getApprovalQueue } from "#core/daemon/approval-queue.js";
import { setIdempotencyStoreInstance } from "#core/daemon/idempotency-singleton.js";
import { IdempotencyStore } from "#core/daemon/idempotency-store.js";
import { setOwnerQuestionQueueInstance } from "#core/daemon/owner-question-queue.js";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "#core/daemon/runtime-scope-provider.js";
import { capScopeAutonomyMode } from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { initTaskStore, setTaskStoreInstance } from "#core/daemon/task-store.js";
import { initEventBus, tryEmit } from "#core/events/event-bus.js";
import { remoteMcpToolDescriptionQualityReportsFromManager } from "#core/mcp/tool-description-quality.js";
import { createModelClient } from "#core/model/model-client.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import type { CreateSessionOptions, ModuleSession } from "#core/modules/module-types.js";
import { registerDefaultProviders } from "#core/modules/provider-registry.js";
import {
  setConfigProvider,
  setModuleInfoProvider,
  setToolDescriptionQualityProvider,
} from "#core/tools/agent-status.js";
import { isAutonomyMode } from "#core/tools/autonomy-mode.js";
import { resolveDelegateConfig } from "#core/tools/delegate-config.js";
import {
  cloneGuardrailsConfig,
  createGuardrailsSnapshot,
  getDefaultConfig as getDefaultGuardrails,
} from "#core/tools/guardrails.js";
import { registerSessionEnvironment } from "#core/tools/session-environment.js";
import { enableGroup } from "#core/tools/tool-groups.js";
import { buildSessionWarmup } from "#root/init.js";
import { Context } from "./context.js";
import { CostTracker } from "./cost.js";
import { initChangeTracker } from "./file-changes.js";
import { loadInstructionContext } from "./instruction-files.js";
import type { LoopOptions } from "./loop.js";
import { type AgentLoopState, runInitModules, saveToHistoryImpl } from "./loop-init.js";
import { getAgentLoopTokenBudget, setAgentLoopTokenBudget } from "./loop-token-budget.js";
import { loadScopeContext } from "./scope-context.js";
import { SessionStateMachine } from "./session-state.js";
import { NullTransport, ProxyTransport } from "./transport.js";

export function initAgentSession(
  state: AgentLoopState,
  options: LoopOptions,
  sessionFactory: (opts: CreateSessionOptions) => ModuleSession,
): void {
  const scopeRoot = options.scopeRuntime?.scope.scopeRoot ?? options.scopeRoot ?? process.cwd();
  if (options.requireExistingConversation) {
    if (options.continuityKey === undefined) throw new Error("Conversation recovery requires a continuityKey.");
    requireAgentConversation(scopeRoot, options.continuityKey);
  }
  state.scopeRoot = scopeRoot;
  state.authorityConfigPath = options.scopeRuntime?.authorityConfigPath ?? getGlobalConfigPath();
  state.scopeId = options.scopeRuntime?.scope.scopeId
    ?? deriveDirectoryScopeId(scopeRoot);
  state.sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  state.sessionLabel = options.label;
  if (!isAutonomyMode(options.autonomyMode)) {
    throw new Error(
      "AgentSession requires an explicit autonomyMode (passive | supervised | autonomous)",
    );
  }
  state.scopePolicyAuthority = options.scopeRuntime?.scopePolicyAuthority;
  const initialScopePolicy = state.scopePolicyAuthority?.getSnapshot(state.scopeId).policy;
  state.autonomyMode = initialScopePolicy
    ? capScopeAutonomyMode(options.autonomyMode, initialScopePolicy)
    : options.autonomyMode;
  state.mcpInputResolver = options.mcpInputResolver;
  state.mcpAuthorizationResolver = options.mcpAuthorizationResolver;
  state.mcpServers = options.mcpServers;
  state.clientApprovalResolver = options.clientApprovalResolver;
  const agentRuntime = resolveAgentRuntime(options.config);
  state.model =
    options.model || agentRuntime.preset.defaultModel;
  state.editorModel = options.editorModel || state.model;
  state.maxTokens = options.maxTokens || 8192;
  state.verbose = options.verbose || false;
  state.ownsModuleRuntime = options.moduleLoader === undefined;
  state.moduleLoader = options.moduleLoader
    ?? new ModuleLoader(options.config || {}, state.verbose, { scopeRoot });
  const providers = state.moduleLoader.getProviderRegistry();
  if (options.scopeRuntime || providers.get(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE)) {
    // Capture host ownership once; withdrawal must not turn a session into a disk reader.
    state.resolveRuntimeScope = (scopeId) =>
      providers.get(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE)?.resolve(scopeId)
      ?? { ok: false, scopeId };
  }
  if (state.ownsModuleRuntime) {
    registerDefaultProviders(state.moduleLoader.getProviderRegistry());
  }
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
  state.modelTiers = options.config?.modelTiers;
  state.modelOutputTokenLimits = options.config?.modelOutputTokenLimits;
  state.channelIdentity = options.channelIdentity;
  setAgentLoopTokenBudget(state, options.tokenBudget);
	state.approvalQueue = options.scopeRuntime?.approvalQueue
		?? getApprovalQueue(join(scopeRoot, ".kota", "approvals"));

  const thinkingBudget = options.thinkingBudget || 10_000;
  state.thinkingConfig = options.thinkingEnabled
    ? { type: "enabled", budget_tokens: thinkingBudget }
    : undefined;
  state.effectiveMaxTokens = options.thinkingEnabled
    ? thinkingBudget + state.maxTokens
    : state.maxTokens;

  const resolvedClient = options.client ? { client: options.client, providerName: "injected" } : createModelClient({
    model: state.model,
    provider: options.config?.modelProvider?.type,
    baseUrl: options.config?.modelProvider?.baseUrl,
    apiKey: options.config?.modelProvider?.apiKey,
    scopeRoot,
  });
  state.client = resolvedClient.client;
  state.continuity = {
    key: options.continuityKey
      ?? (options.resumeConversation !== undefined ? `history:${options.resumeConversation}`
        : options.sessionPath !== undefined ? `session-path:${resolve(options.sessionPath)}`
        : state.sessionId),
    providerName: resolvedClient.providerName,
    modelProvider: { provider: options.config?.modelProvider?.type, baseUrl: options.config?.modelProvider?.baseUrl },
  };
  state.costTracker = new CostTracker(state.moduleLoader.getProviderRegistry());

  if (options.scopeRuntime) {
    if (options.scopeRoot !== undefined && options.scopeRoot !== scopeRoot) {
      throw new Error(
        `AgentSession scopeRoot ${options.scopeRoot} does not match scopeRuntime ${scopeRoot}`,
      );
    }
    setTaskStoreInstance(options.scopeRuntime.taskStore);
    setIdempotencyStoreInstance(options.scopeRuntime.idempotencyStore);
    setOwnerQuestionQueueInstance(options.scopeRuntime.ownerQuestionQueue);
    state.idempotencyStore = options.scopeRuntime.idempotencyStore;
  } else {
    initTaskStore(scopeRoot);
    const idempotencyStore = new IdempotencyStore(
      join(scopeRoot, ".kota", "idempotency"),
      deriveDirectoryScopeId(scopeRoot),
    );
    setIdempotencyStoreInstance(idempotencyStore);
    state.idempotencyStore = idempotencyStore;
  }
  initChangeTracker();
  state.scopeContext = loadScopeContext(scopeRoot, scopeRoot);
  const scopeContext = state.scopeContext;
  const instructionContext = loadInstructionContext(scopeRoot, scopeRoot);
  state.instructionContext = instructionContext;
  const warmup = buildSessionWarmup(scopeRoot);
  const userProfile = options.config ? buildUserProfile(options.config) : "";
  const systemPrompt = SYSTEM_PROMPT + scopeContext + instructionContext + userProfile + warmup;
  if (scopeContext && state.verbose) {
    state.transport.emit({ type: "status", message: "[kota] Loaded scope context from .kota.md" });
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
  state.historyProvider = options.historyProvider;
  state.historySource = options.historySource ?? "user";

  if (state.ownsModuleRuntime) {
    state.moduleLoader.setCwd(scopeRoot);
    state.moduleLoader.setBus(
      options.scopeRuntime?.pbus.getUnderlying() ?? initEventBus(),
    );
  }
  const configuredModelProvider = options.config?.modelProvider;
  const delegateModelProvider = configuredModelProvider
    ? {
        ...(configuredModelProvider.type !== undefined
          ? { provider: configuredModelProvider.type }
          : {}),
        ...(configuredModelProvider.baseUrl !== undefined
          ? { baseUrl: configuredModelProvider.baseUrl }
          : {}),
        ...(configuredModelProvider.apiKey !== undefined
          ? { apiKey: configuredModelProvider.apiKey }
          : {}),
      }
    : undefined;
  const hasDelegateModelProvider =
    delegateModelProvider !== undefined && Object.keys(delegateModelProvider).length > 0;
  state.delegationRuntime = resolveDelegateConfig({
    model: state.editorModel,
    effort: agentRuntime.effort,
    modelTiers: agentRuntime.tiers,
    ...(hasDelegateModelProvider ? { modelProvider: delegateModelProvider } : {}),
    modelOutputTokenLimits: options.config?.modelOutputTokenLimits,
    client: state.client,
    cwd: scopeRoot,
    scopeContext: scopeContext || undefined,
    instructionContext: instructionContext || undefined,
    costTracker: state.costTracker,
    transport: state.transport,
    harness: agentRuntime.harness,
    resolveAgentDef: (name) => state.moduleLoader.getAgentDef(name),
    resolveSkillsPrompt: (names, agentName) =>
      state.moduleLoader.getSkillsPromptFor(names, agentName),
    tokenBudget: getAgentLoopTokenBudget(state),
  });
  setModuleInfoProvider(() =>
    state.moduleLoader.getLoadedModules().map((name) => ({
      name,
      toolCount: 0,
    })),
  );
  setToolDescriptionQualityProvider(() =>
    state.mcpManager
      ? remoteMcpToolDescriptionQualityReportsFromManager(state.mcpManager)
      : [],
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
  if (state.ownsModuleRuntime) state.moduleLoader.setSessionFactory(sessionFactory);

  state.stateMachine = new SessionStateMachine();
  state.stateMachine.onChange((from, to, meta) => {
    state.transport.emit({ type: "state_change", from, to, meta });
    tryEmit("session.state", { sessionId: state.sessionId, from, to, meta });
  });
  state.stateMachine.transition("initializing");
  registerSessionEnvironment({
    sessionId: state.sessionId,
    scopeId: state.scopeId,
  });
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
