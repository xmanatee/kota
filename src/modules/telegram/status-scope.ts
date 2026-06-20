import { join } from "node:path";
import type {
  TelegramStatusPollProjectRouting,
  TelegramStatusScope,
  TelegramStatusScopeResolution,
} from "./status-types.js";

export async function resolveTelegramStatusScope(
  messageChatId: number,
  defaultScope: TelegramStatusScope,
  projectRouting?: TelegramStatusPollProjectRouting,
): Promise<TelegramStatusScopeResolution> {
  if (!projectRouting) return { ok: true, scope: defaultScope };
  const resolved = await projectRouting.selection.resolveChat(messageChatId);
  if (!resolved.ok) return resolved;
  const scoped = projectRouting.client.forProject(resolved.project.projectId);
  return {
    ok: true,
    scope: {
      projectDir: resolved.project.projectDir,
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
          runsDir: join(resolved.project.projectDir, ".kota", "runs"),
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
