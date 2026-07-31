import { type KotaClient, KotaClientProjectError } from "./kota-client.js";
import {
  createProjectScopedSetupClient,
  runScopedKotaClientOperation,
} from "./project-scoped-setup-client.js";
import { createScopedWorkflowClient } from "./project-scoped-workflow-client.js";
import {
  mergeScopeSelector,
  normalizeScopeSelector,
  type ScopeSelector,
  selectedScopeSelectorId,
} from "./scope-selector.js";

function withScope<T extends ScopeSelector>(
  value: T | undefined,
  selector: ScopeSelector,
): T & ScopeSelector {
  return mergeScopeSelector(value, selector);
}

export function createProjectScopedKotaClient(
  base: KotaClient,
  projectId: string,
): KotaClient {
  return createScopedKotaClient(base, { projectId }, projectId);
}
export function createScopeScopedKotaClient(
  base: KotaClient,
  scopeId: string,
): KotaClient {
  return createScopedKotaClient(base, { scopeId }, scopeId);
}

function createScopedKotaClient(
  base: KotaClient,
  selectorInput: ScopeSelector,
  errorId: string,
): KotaClient {
  const selector = normalizeScopeSelector(selectorInput);
  const selectedId = selectedScopeSelectorId(selector);
  if (!selectedId) {
    throw new KotaClientProjectError(errorId);
  }
  const scoped = runScopedKotaClientOperation;

  return {
    ...base,
    forProject: (nextProjectId) =>
      createProjectScopedKotaClient(base, nextProjectId),
    forScope: (nextScopeId) =>
      createScopeScopedKotaClient(base, nextScopeId),
    workflow: createScopedWorkflowClient({
      base: base.workflow,
      selector,
      selectedId,
      scoped,
      withScope,
    }),
    ui: {
      listSurfaces: () =>
        scoped(selectedId, () => base.ui.listSurfaces(selector)),
      executeAction: (input) =>
        scoped(selectedId, () =>
          base.ui.executeAction(withScope(input, selector)),
        ),
      watchEvents: (input) => base.ui.watchEvents(input),
    },
    memory: {
      list: (filter) =>
        scoped(selectedId, () =>
          base.memory.list(withScope(filter, selector)),
        ),
      add: (content, tags, project) =>
        scoped(selectedId, () =>
          base.memory.add(content, tags, withScope(project, selector)),
        ),
      delete: (id, project) =>
        scoped(selectedId, () =>
          base.memory.delete(id, withScope(project, selector)),
        ),
      search: (query, filter) =>
        scoped(selectedId, () =>
          base.memory.search(query, withScope(filter, selector)),
        ),
      reindex: (project) =>
        scoped(selectedId, () =>
          base.memory.reindex(withScope(project, selector)),
        ),
    },
    knowledge: {
      list: (filter) =>
        scoped(selectedId, () =>
          base.knowledge.list(withScope(filter, selector)),
        ),
      show: (id, project) =>
        scoped(selectedId, () =>
          base.knowledge.show(id, withScope(project, selector)),
        ),
      search: (query, filter) =>
        scoped(selectedId, () =>
          base.knowledge.search(query, withScope(filter, selector)),
        ),
      add: (options) =>
        scoped(selectedId, () =>
          base.knowledge.add(withScope(options, selector)),
        ),
      delete: (id, project) =>
        scoped(selectedId, () =>
          base.knowledge.delete(id, withScope(project, selector)),
        ),
      reindex: (project) =>
        scoped(selectedId, () =>
          base.knowledge.reindex(withScope(project, selector)),
        ),
    },
    history: {
      list: (filter) =>
        scoped(selectedId, () =>
          base.history.list(withScope(filter, selector)),
        ),
      listDiscoveredProjectRecords: (filter) =>
        base.history.listDiscoveredProjectRecords(filter),
      show: (id, project) =>
        scoped(selectedId, () =>
          base.history.show(id, withScope(project, selector)),
        ),
      delete: (id, project) =>
        scoped(selectedId, () =>
          base.history.delete(id, withScope(project, selector)),
        ),
      search: (query, filter) =>
        scoped(selectedId, () =>
          base.history.search(query, withScope(filter, selector)),
        ),
      reindex: (project) =>
        scoped(selectedId, () =>
          base.history.reindex(withScope(project, selector)),
        ),
    },
    inboundSignals: {
      listRoutes: (project) =>
        scoped(selectedId, () =>
          base.inboundSignals.listRoutes(withScope(project, selector)),
        ),
      validateRoutes: (project) =>
        scoped(selectedId, () =>
          base.inboundSignals.validateRoutes(withScope(project, selector)),
        ),
    },
    tasks: {
      list: (states, project) =>
        scoped(selectedId, () =>
          base.tasks.list(states, withScope(project, selector)),
        ),
      show: (id, project) =>
        scoped(selectedId, () =>
          base.tasks.show(id, withScope(project, selector)),
        ),
      move: (id, toState, project) =>
        scoped(selectedId, () =>
          base.tasks.move(id, toState, withScope(project, selector)),
        ),
      create: (options) =>
        scoped(selectedId, () =>
          base.tasks.create(withScope(options, selector)),
        ),
      capture: (title, project) =>
        scoped(selectedId, () =>
          base.tasks.capture(title, withScope(project, selector)),
        ),
      gc: (options) =>
        scoped(selectedId, () =>
          base.tasks.gc(withScope(options, selector)),
        ),
      search: (query, filter) =>
        scoped(selectedId, () =>
          base.tasks.search(query, withScope(filter, selector)),
        ),
      reindex: (project) =>
        scoped(selectedId, () =>
          base.tasks.reindex(withScope(project, selector)),
        ),
    },
    recall: {
      recall: (query, filter) =>
        scoped(selectedId, () =>
          base.recall.recall(query, withScope(filter, selector)),
        ),
    },
    resourceDiscovery: {
      discover: (query, filter) =>
        scoped(selectedId, () =>
          base.resourceDiscovery.discover(query, withScope(filter, selector)),
        ),
    },
    answer: {
      answer: (query, filter) =>
        scoped(selectedId, () =>
          base.answer.answer(query, withScope(filter, selector)),
        ),
      log: (filter) =>
        scoped(selectedId, () =>
          base.answer.log(withScope(filter, selector)),
        ),
      show: (id, project) =>
        scoped(selectedId, () =>
          base.answer.show(id, withScope(project, selector)),
        ),
    },
    capture: {
      capture: (text, filter) =>
        scoped(selectedId, () =>
          base.capture.capture(text, withScope(filter, selector)),
        ),
    },
    retract: {
      retract: (request) =>
        scoped(selectedId, () =>
          base.retract.retract(withScope(request, selector)),
        ),
    },
    approvals: {
      list: (filter) =>
        scoped(selectedId, () =>
          base.approvals.list(withScope(filter, selector)),
        ),
	  approve: (id, reviewDigest, note, project) =>
		scoped(selectedId, () =>
		  base.approvals.approve(id, reviewDigest, note, withScope(project, selector)),
		),
      reject: (id, reason, project) =>
        scoped(selectedId, () =>
          base.approvals.reject(id, reason, withScope(project, selector)),
        ),
    },
    secrets: {
      list: (project) =>
        scoped(selectedId, () =>
          base.secrets.list(withScope(project, selector)),
        ),
      get: (name, project) =>
        scoped(selectedId, () =>
          base.secrets.get(name, withScope(project, selector)),
        ),
      set: (name, value, scope, project) =>
        scoped(selectedId, () =>
          base.secrets.set(name, value, scope, withScope(project, selector)),
        ),
      remove: (name, scope, project) =>
        scoped(selectedId, () =>
          base.secrets.remove(name, scope, withScope(project, selector)),
        ),
    },
    setup: createProjectScopedSetupClient({
      base: base.setup,
      selector,
      selectedId,
    }),
    ownerDecisions: {
      list: (filter) =>
        scoped(selectedId, () =>
          base.ownerDecisions.list(withScope(filter, selector)),
        ),
      show: (id, project) =>
        scoped(selectedId, () =>
          base.ownerDecisions.show(id, withScope(project, selector)),
        ),
      answer: (id, selectedValue, project) =>
        scoped(selectedId, () =>
          base.ownerDecisions.answer(id, selectedValue, withScope(project, selector)),
        ),
      cancel: (id, reason, project) =>
        scoped(selectedId, () =>
          base.ownerDecisions.cancel(id, reason, withScope(project, selector)),
        ),
    },
    ownerQuestions: {
      list: (filter) =>
        scoped(selectedId, () =>
          base.ownerQuestions.list(withScope(filter, selector)),
        ),
      answer: (id, answer, project) =>
        scoped(selectedId, () =>
          base.ownerQuestions.answer(id, answer, withScope(project, selector)),
        ),
      dismiss: (id, reason, project) =>
        scoped(selectedId, () =>
          base.ownerQuestions.dismiss(id, reason, withScope(project, selector)),
        ),
    },
  };
}
