import {
  getHistoryProvider,
  getKnowledgeProvider,
  getMemoryProvider,
  getRepoTasksProvider,
} from "#core/modules/provider-registry.js";
import { createHistoryProjectStores } from "#modules/history/project-scope.js";
import { createKnowledgeProjectStores } from "#modules/knowledge/project-scope.js";
import { createMemoryProjectStores } from "#modules/memory/project-scope.js";
import { createRepoTasksProjectStores } from "#modules/repo-tasks/project-scope.js";
import type { RecallProjectContext } from "./recall-types.js";

export type ResolveRecallProjectContext = (
  projectId: string | null | undefined,
) => RecallProjectContext | { error: "unknown_project"; projectId: string };

export function createRecallProjectContextResolver(
  defaultProjectDir: string,
): ResolveRecallProjectContext {
  const memoryStores = createMemoryProjectStores(defaultProjectDir, () =>
    getMemoryProvider(),
  );
  const knowledgeStores = createKnowledgeProjectStores(defaultProjectDir, () =>
    getKnowledgeProvider(),
  );
  const historyStores = createHistoryProjectStores(defaultProjectDir, () =>
    getHistoryProvider(),
  );
  const taskStores = createRepoTasksProjectStores(defaultProjectDir, () =>
    getRepoTasksProvider(),
  );

  return (projectId) => {
    const memory = memoryStores.resolve(projectId);
    if (!memory.ok) {
      return { error: "unknown_project", projectId: memory.error.projectId };
    }
    const knowledge = knowledgeStores.resolve(memory.projectId);
    if (!knowledge.ok) {
      return { error: "unknown_project", projectId: knowledge.error.projectId };
    }
    const history = historyStores.resolve(memory.projectId);
    if (!history.ok) {
      return { error: "unknown_project", projectId: history.error.projectId };
    }
    const tasks = taskStores.resolve(memory.projectId);
    if (!tasks.ok) {
      return { error: "unknown_project", projectId: tasks.error.projectId };
    }
    return {
      projectId: memory.projectId,
      projectDir: memory.projectDir,
      knowledge: knowledge.store,
      memory: memory.store,
      history: history.store,
      tasks: tasks.store,
    };
  };
}
