import type {
  AgentHarnessResult,
  AgentHarnessRunOptions,
  KotaMessage,
  KotaTool,
} from "#core/agent-harness/index.js";
import type { ResolvedProvider } from "#core/model/model-client.js";
import type { ResolvedModelOutputTokenLimit } from "#core/model/output-token-limits.js";
import {
  buildConversationSessionContext,
  type ConversationSessionRecord,
  type ConversationSessionToolDeclaration,
  loadConversationSession,
  persistConversationSession,
  snapshotConversationSessionToolDeclarations,
  validateConversationSessionContext,
  validateConversationSessionTools,
} from "./conversation-store.js";
import type { KotaJsonValue } from "./message-protocol.js";

export type ConversationSessionRuntime = {
  messages: KotaMessage[];
  readonly adapterState: KotaJsonValue | undefined;
  checkpointAdapter(state: KotaJsonValue): void;
  sessionId: string | undefined;
  validateTools(
    tools: readonly KotaTool[],
    mcpFingerprints: ReadonlyMap<string, string> | undefined,
  ): void;
  checkpoint(lastProviderMessageId?: string): void;
  finalize(
    result: AgentHarnessResult,
    lastProviderMessageId: string | undefined,
  ): AgentHarnessResult;
};

export function createConversationSessionRuntime(input: {
  harness?: string;
  /** Seed an explicitly owned legacy conversation on its first durable invocation. */
  initialState?: { messages: readonly KotaMessage[]; adapterState: KotaJsonValue };
  options: AgentHarnessRunOptions;
  scopeRoot: string;
  resolved: Pick<ResolvedProvider, "model" | "providerName">;
  outputTokenLimit: Pick<ResolvedModelOutputTokenLimit, "maxTokens">;
}): ConversationSessionRuntime {
  const context = buildConversationSessionContext(input);
  let persistedSession: ConversationSessionRecord | undefined;
  if (input.options.resumeSessionId !== undefined) {
    persistedSession = loadConversationSession(
      input.options.scopeRoot ?? input.scopeRoot,
      input.options.resumeSessionId,
    );
    if (persistedSession.harness !== (input.harness ?? "openai-tools")) throw new Error("The preserved conversation belongs to another harness.");
    validateConversationSessionContext(persistedSession, context);
  }

  const priorMessages = [...(persistedSession?.messages ?? input.initialState?.messages ?? [])];
  const tail = priorMessages.at(-1);
  if (tail?.role === "assistant" && Array.isArray(tail.content)) {
    const pending = tail.content.filter((block) => block.type === "tool_use");
    if (pending.length > 0) priorMessages.push({ role: "user", content: pending.map((block) => ({ type: "tool_result" as const, tool_use_id: block.id, is_error: true, content: "Execution was interrupted before a durable result. The effect may have happened. Inspect saved work and reconcile external effects before attempting further actions; do not replay this call." })) });
  }
  const messages: KotaMessage[] = [...priorMessages, { role: "user", content: input.options.prompt }];
  let latestToolDeclarations: ConversationSessionToolDeclaration[] =
    persistedSession?.toolDeclarations ?? [];
  let resumeToolsValidated = persistedSession === undefined;
  const persistenceRequested = input.options.persistSession === true ||
    persistedSession !== undefined;

  let adapterState = persistedSession === undefined ? input.initialState?.adapterState : persistedSession.adapterState;
  const persist = (lastProviderMessageId?: string): void => {
    if (!persistenceRequested) return;
    input.options.abortController?.signal.throwIfAborted();
    persistedSession = persistConversationSession({
      scopeRoot: input.options.scopeRoot ?? input.scopeRoot,
      harness: input.harness,
      existing: persistedSession,
      context,
      toolDeclarations: latestToolDeclarations,
      messages,
      ...(adapterState === undefined ? {} : { adapterState }),
      ...(lastProviderMessageId !== undefined
        ? { lastProviderMessageId }
        : persistedSession?.lastProviderMessageId !== undefined
        ? { lastProviderMessageId: persistedSession.lastProviderMessageId }
        : {}),
    });
  };

  // Establish the KOTA-owned identity before model dispatch. Active
  // continuation can then quiesce a turn without mistaking a provider message
  // id for a resumable local session.
  if (persistedSession === undefined) persist();
  if (persistedSession !== undefined) input.options.onSessionId?.(persistedSession.id);

  return {
    messages,
    get adapterState() { return adapterState; },
    checkpointAdapter(state) { adapterState = state; persist(); },
    get sessionId() {
      return persistedSession?.id;
    },
    validateTools(tools, mcpFingerprints) {
      const toolDeclarations = snapshotConversationSessionToolDeclarations(
        tools,
        mcpFingerprints,
      );
      if (!resumeToolsValidated && persistedSession !== undefined) {
        validateConversationSessionTools(persistedSession, toolDeclarations);
        resumeToolsValidated = true;
      }
      latestToolDeclarations = toolDeclarations;
      persist();
    },
    checkpoint(lastProviderMessageId) {
      persist(lastProviderMessageId);
    },
    finalize(result, lastProviderMessageId) {
      if (!persistenceRequested) {
        return result;
      }
      persist(lastProviderMessageId);
      return persistedSession === undefined
        ? result
        : { ...result, sessionId: persistedSession.id };
    },
  };
}
