import {
  getKnowledgeProvider,
  getMemoryProvider,
} from "#core/modules/provider-registry.js";
import { createKnowledgeProjectStores } from "#modules/knowledge/project-scope.js";
import { createMemoryProjectStores } from "#modules/memory/project-scope.js";
import type { RetractProjectContext } from "./retract-types.js";

export type ResolveRetractProjectContext = (
  projectId: string | null | undefined,
) => RetractProjectContext | { error: "unknown_project"; projectId: string };

export function createRetractProjectContextResolver(
  defaultProjectDir: string,
): ResolveRetractProjectContext {
  const memoryStores = createMemoryProjectStores(defaultProjectDir, () =>
    getMemoryProvider(),
  );
  const knowledgeStores = createKnowledgeProjectStores(defaultProjectDir, () =>
    getKnowledgeProvider(),
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
    return {
      projectId: memory.projectId,
      projectDir: memory.projectDir,
      memory: memory.store,
      knowledge: knowledge.store,
    };
  };
}
