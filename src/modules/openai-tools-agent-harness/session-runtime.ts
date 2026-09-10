import type {
  AgentHarnessResult,
  AgentHarnessRunOptions,
  KotaMessage,
  KotaTool,
} from "#core/agent-harness/index.js";
import type { ResolvedProvider } from "#core/model/model-client.js";
import type { ResolvedModelOutputTokenLimit } from "#core/model/output-token-limits.js";
import {
  buildOpenaiToolsSessionContext,
  loadOpenaiToolsSession,
  type OpenaiToolsSessionRecord,
  type OpenaiToolsSessionToolDeclaration,
  persistOpenaiToolsSession,
  snapshotOpenaiToolsSessionToolDeclarations,
  validateOpenaiToolsSessionContext,
  validateOpenaiToolsSessionTools,
} from "./session-store.js";

export type OpenaiToolsSessionRuntime = {
  messages: KotaMessage[];
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

export function createOpenaiToolsSessionRuntime(input: {
  options: AgentHarnessRunOptions;
  scopeRoot: string;
  resolved: ResolvedProvider;
  outputTokenLimit: ResolvedModelOutputTokenLimit;
}): OpenaiToolsSessionRuntime {
  const context = buildOpenaiToolsSessionContext(input);
  let persistedSession: OpenaiToolsSessionRecord | undefined;
  if (input.options.resumeSessionId !== undefined) {
    persistedSession = loadOpenaiToolsSession(
      input.scopeRoot,
      input.options.resumeSessionId,
    );
    validateOpenaiToolsSessionContext(persistedSession, context);
  }

  const messages: KotaMessage[] =
    persistedSession === undefined
      ? [{ role: "user", content: input.options.prompt }]
      : [...persistedSession.messages, { role: "user", content: input.options.prompt }];
  let latestToolDeclarations: OpenaiToolsSessionToolDeclaration[] =
    persistedSession?.toolDeclarations ?? [];
  let resumeToolsValidated = persistedSession === undefined;
  const persistenceRequested = input.options.persistSession === true ||
    persistedSession !== undefined;

  const persist = (lastProviderMessageId?: string): void => {
    if (!persistenceRequested) return;
    persistedSession = persistOpenaiToolsSession({
      scopeRoot: input.scopeRoot,
      existing: persistedSession,
      context,
      toolDeclarations: latestToolDeclarations,
      messages,
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
  persist();

  return {
    messages,
    get sessionId() {
      return persistedSession?.id;
    },
    validateTools(tools, mcpFingerprints) {
      const toolDeclarations = snapshotOpenaiToolsSessionToolDeclarations(
        tools,
        mcpFingerprints,
      );
      if (!resumeToolsValidated && persistedSession !== undefined) {
        validateOpenaiToolsSessionTools(persistedSession, toolDeclarations);
        resumeToolsValidated = true;
      }
      latestToolDeclarations = toolDeclarations;
      persist();
    },
    checkpoint(lastProviderMessageId) {
      persist(lastProviderMessageId);
    },
    finalize(result, lastProviderMessageId) {
      if (
        result.isError ||
        !persistenceRequested
      ) {
        return result;
      }
      persist(lastProviderMessageId);
      return persistedSession === undefined
        ? result
        : { ...result, sessionId: persistedSession.id };
    },
  };
}
