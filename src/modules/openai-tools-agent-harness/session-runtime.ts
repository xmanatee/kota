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
  validateTools(
    tools: readonly KotaTool[],
    mcpFingerprints: ReadonlyMap<string, string> | undefined,
  ): void;
  finalize(
    result: AgentHarnessResult,
    lastProviderMessageId: string | undefined,
  ): AgentHarnessResult;
};

export function createOpenaiToolsSessionRuntime(input: {
  options: AgentHarnessRunOptions;
  projectDir: string;
  resolved: ResolvedProvider;
  outputTokenLimit: ResolvedModelOutputTokenLimit;
}): OpenaiToolsSessionRuntime {
  const context = buildOpenaiToolsSessionContext(input);
  let persistedSession: OpenaiToolsSessionRecord | undefined;
  if (input.options.resumeSessionId !== undefined) {
    persistedSession = loadOpenaiToolsSession(
      input.projectDir,
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

  return {
    messages,
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
    },
    finalize(result, lastProviderMessageId) {
      if (
        result.isError ||
        (input.options.persistSession !== true && persistedSession === undefined)
      ) {
        return result;
      }
      const nextSession = persistOpenaiToolsSession({
        projectDir: input.projectDir,
        existing: persistedSession,
        context,
        toolDeclarations: latestToolDeclarations,
        messages,
        ...(lastProviderMessageId !== undefined
          ? { lastProviderMessageId }
          : {}),
      });
      persistedSession = nextSession;
      return { ...result, sessionId: nextSession.id };
    },
  };
}
