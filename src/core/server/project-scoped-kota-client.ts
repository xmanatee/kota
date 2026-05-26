import {
  type KotaClient,
  KotaClientProjectError,
} from "./kota-client.js";

function withProject<T extends object>(
  value: T | undefined,
  projectId: string,
): T & { projectId: string } {
  if (value) return { ...value, projectId };
  return { projectId } as T & { projectId: string };
}

function isUnknownProjectMessage(message: string): boolean {
  return /^Unknown project(?::|$)/.test(message);
}

async function scoped<T>(
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (err instanceof KotaClientProjectError) throw err;
    if (err instanceof Error && isUnknownProjectMessage(err.message)) {
      throw new KotaClientProjectError(projectId, err);
    }
    throw err;
  }
}

export function createProjectScopedKotaClient(
  base: KotaClient,
  projectId: string,
): KotaClient {
  const selectedProjectId = projectId.trim();
  if (!selectedProjectId) {
    throw new KotaClientProjectError(projectId);
  }

  return {
    ...base,
    forProject: (nextProjectId) =>
      createProjectScopedKotaClient(base, nextProjectId),
    workflow: {
      ...base.workflow,
      status: (filter) =>
        scoped(selectedProjectId, () =>
          base.workflow.status(withProject(filter, selectedProjectId)),
        ),
      trial: (name, options) =>
        scoped(selectedProjectId, () =>
          base.workflow.trial(name, withProject(options, selectedProjectId)),
        ),
    },
    memory: {
      list: (filter) =>
        scoped(selectedProjectId, () =>
          base.memory.list(withProject(filter, selectedProjectId)),
        ),
      add: (content, tags, project) =>
        scoped(selectedProjectId, () =>
          base.memory.add(content, tags, withProject(project, selectedProjectId)),
        ),
      delete: (id, project) =>
        scoped(selectedProjectId, () =>
          base.memory.delete(id, withProject(project, selectedProjectId)),
        ),
      search: (query, filter) =>
        scoped(selectedProjectId, () =>
          base.memory.search(query, withProject(filter, selectedProjectId)),
        ),
      reindex: (project) =>
        scoped(selectedProjectId, () =>
          base.memory.reindex(withProject(project, selectedProjectId)),
        ),
    },
    knowledge: {
      list: (filter) =>
        scoped(selectedProjectId, () =>
          base.knowledge.list(withProject(filter, selectedProjectId)),
        ),
      show: (id, project) =>
        scoped(selectedProjectId, () =>
          base.knowledge.show(id, withProject(project, selectedProjectId)),
        ),
      search: (query, filter) =>
        scoped(selectedProjectId, () =>
          base.knowledge.search(query, withProject(filter, selectedProjectId)),
        ),
      add: (options) =>
        scoped(selectedProjectId, () =>
          base.knowledge.add(withProject(options, selectedProjectId)),
        ),
      delete: (id, project) =>
        scoped(selectedProjectId, () =>
          base.knowledge.delete(id, withProject(project, selectedProjectId)),
        ),
      reindex: (project) =>
        scoped(selectedProjectId, () =>
          base.knowledge.reindex(withProject(project, selectedProjectId)),
        ),
    },
    history: {
      list: (filter) =>
        scoped(selectedProjectId, () =>
          base.history.list(withProject(filter, selectedProjectId)),
        ),
      listDiscoveredProjectRecords: (filter) =>
        base.history.listDiscoveredProjectRecords(filter),
      show: (id, project) =>
        scoped(selectedProjectId, () =>
          base.history.show(id, withProject(project, selectedProjectId)),
        ),
      delete: (id, project) =>
        scoped(selectedProjectId, () =>
          base.history.delete(id, withProject(project, selectedProjectId)),
        ),
      search: (query, filter) =>
        scoped(selectedProjectId, () =>
          base.history.search(query, withProject(filter, selectedProjectId)),
        ),
      reindex: (project) =>
        scoped(selectedProjectId, () =>
          base.history.reindex(withProject(project, selectedProjectId)),
        ),
    },
    tasks: {
      list: (states, project) =>
        scoped(selectedProjectId, () =>
          base.tasks.list(states, withProject(project, selectedProjectId)),
        ),
      show: (id, project) =>
        scoped(selectedProjectId, () =>
          base.tasks.show(id, withProject(project, selectedProjectId)),
        ),
      move: (id, toState, project) =>
        scoped(selectedProjectId, () =>
          base.tasks.move(id, toState, withProject(project, selectedProjectId)),
        ),
      create: (options) =>
        scoped(selectedProjectId, () =>
          base.tasks.create(withProject(options, selectedProjectId)),
        ),
      capture: (title, project) =>
        scoped(selectedProjectId, () =>
          base.tasks.capture(title, withProject(project, selectedProjectId)),
        ),
      gc: (options) =>
        scoped(selectedProjectId, () =>
          base.tasks.gc(withProject(options, selectedProjectId)),
        ),
      search: (query, filter) =>
        scoped(selectedProjectId, () =>
          base.tasks.search(query, withProject(filter, selectedProjectId)),
        ),
      reindex: (project) =>
        scoped(selectedProjectId, () =>
          base.tasks.reindex(withProject(project, selectedProjectId)),
        ),
    },
    recall: {
      recall: (query, filter) =>
        scoped(selectedProjectId, () =>
          base.recall.recall(query, withProject(filter, selectedProjectId)),
        ),
    },
    answer: {
      answer: (query, filter) =>
        scoped(selectedProjectId, () =>
          base.answer.answer(query, withProject(filter, selectedProjectId)),
        ),
      log: (filter) =>
        scoped(selectedProjectId, () =>
          base.answer.log(withProject(filter, selectedProjectId)),
        ),
      show: (id, project) =>
        scoped(selectedProjectId, () =>
          base.answer.show(id, withProject(project, selectedProjectId)),
        ),
    },
    capture: {
      capture: (text, filter) =>
        scoped(selectedProjectId, () =>
          base.capture.capture(text, withProject(filter, selectedProjectId)),
        ),
    },
    retract: {
      retract: (request) =>
        scoped(selectedProjectId, () =>
          base.retract.retract({ ...request, projectId: selectedProjectId }),
        ),
    },
    approvals: {
      list: (filter) =>
        scoped(selectedProjectId, () =>
          base.approvals.list(withProject(filter, selectedProjectId)),
        ),
      approve: (id, note, project) =>
        scoped(selectedProjectId, () =>
          base.approvals.approve(id, note, withProject(project, selectedProjectId)),
        ),
      reject: (id, reason, project) =>
        scoped(selectedProjectId, () =>
          base.approvals.reject(id, reason, withProject(project, selectedProjectId)),
        ),
    },
    ownerQuestions: {
      list: (filter) =>
        scoped(selectedProjectId, () =>
          base.ownerQuestions.list(withProject(filter, selectedProjectId)),
        ),
      answer: (id, answer, project) =>
        scoped(selectedProjectId, () =>
          base.ownerQuestions.answer(id, answer, withProject(project, selectedProjectId)),
        ),
      dismiss: (id, reason, project) =>
        scoped(selectedProjectId, () =>
          base.ownerQuestions.dismiss(id, reason, withProject(project, selectedProjectId)),
        ),
    },
  };
}
