import { z } from "zod";
import { createConversationSessionRuntime } from "#core/agent-harness/conversation-runtime.js";
import { prepareSessionContinuity, runWithSessionRecovery, SessionRecoveryError } from "#core/agent-harness/session-continuity.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import type { ModelProviderSelection } from "#core/model/model-client.js";
import type { AgentLoopState } from "./loop-init.js";

export type LoopContinuity = {
  key: string;
  providerName: string;
  modelProvider?: ModelProviderSelection;
};

const contextState = z.object({
  compactionCount: z.number().int().nonnegative(),
  lastInputTokens: z.number().finite().nonnegative(),
});

/** Direct ModelClient sessions share harness ownership, recovery and storage. */
export async function startLoopConversation(state: AgentLoopState, prompt: string, abortController: AbortController) {
  const binding = state.continuity;
  if (binding === undefined) return undefined;
  const harness = "agent-session";
  const continuity = prepareSessionContinuity({ name: harness }, {
    prompt, effort: "high", model: state.model, scopeRoot: state.scopeRoot,
    cwd: state.scopeRoot, continuityKey: binding.key,
    sessionContext: { sessionId: state.sessionId, scopeId: state.scopeId },
    modelProvider: binding.modelProvider, abortController,
  });
  try {
    const runtime = await runWithSessionRecovery(continuity, continuity.options, async (options: AgentHarnessRunOptions) => {
      const snapshot = state.context.snapshot();
      const runtime = createConversationSessionRuntime({
        harness, options, scopeRoot: state.scopeRoot,
        ...(continuity.isNewConversation ? { initialState: {
          messages: snapshot.messages,
          adapterState: { compactionCount: snapshot.compactionCount, lastInputTokens: snapshot.lastInputTokens },
        } } : {}),
        resolved: { model: state.model, providerName: binding.providerName },
        outputTokenLimit: { maxTokens: state.effectiveMaxTokens },
      });
      const parsed = runtime.adapterState === undefined ? undefined : contextState.safeParse(runtime.adapterState);
      if (parsed && !parsed.success) throw new SessionRecoveryError("The saved loop context metadata is corrupt; its evidence was retained.");
      const metadata = parsed?.success ? parsed.data : { compactionCount: 0, lastInputTokens: 0 };
      state.context.restoreFrom(runtime.messages, metadata.compactionCount, metadata.lastInputTokens);
      return runtime;
    });
    return {
      checkpoint() {
        const snapshot = state.context.snapshot();
        // Compaction can replace the Context message array.
        if (runtime.messages !== snapshot.messages) runtime.messages.splice(0, runtime.messages.length, ...snapshot.messages);
        runtime.checkpointAdapter({ compactionCount: snapshot.compactionCount, lastInputTokens: snapshot.lastInputTokens });
      },
      release: continuity.release,
    };
  } catch (error) {
    continuity.release();
    throw error;
  }
}
