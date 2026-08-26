import { join } from "node:path";
import type {
  TelegramStatusPollScopeRouting,
  TelegramStatusScope,
  TelegramStatusScopeResolution,
} from "./status-types.js";

export async function resolveTelegramStatusScope(
  messageChatId: number,
  defaultScope: TelegramStatusScope,
  scopeRouting?: TelegramStatusPollScopeRouting,
): Promise<TelegramStatusScopeResolution> {
  if (!scopeRouting) return { ok: true, scope: defaultScope };
  const resolved = await scopeRouting.selection.resolveChat(messageChatId);
  if (!resolved.ok) return resolved;
  const scoped = scopeRouting.client.forScope(resolved.scope.scopeId);
  return {
    ok: true,
    scope: {
      scopeRoot: resolved.scope.scopeRoot,
      getStatusInfo: async () => {
        const status = await scoped.workflow.status();
        return {
          runtimeState: {
            activeRuns: status.activeRuns,
            completedRuns: status.completedRuns,
            pendingRuns: status.pendingRuns,
            workflows: status.workflows,
          },
          dispatchPaused: status.paused,
          runsDir: join(resolved.scope.scopeRoot, ".kota", "runs"),
        };
      },
      knowledge: scoped.knowledge,
      memory: scoped.memory,
      history: scoped.history,
      tasks: scoped.tasks,
      recall: scoped.recall,
      answer: scoped.answer,
      capture: scoped.capture,
      retract: scoped.retract,
    },
  };
}
