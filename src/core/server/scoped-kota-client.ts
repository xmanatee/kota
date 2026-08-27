import { type KotaClient, KotaClientScopeError } from "#root/client/kota-client.generated.js";
import {
  mergeScopeSelector,
  normalizeScopeSelector,
  type ScopeSelector,
  selectedScopeSelectorId,
} from "./scope-selector.js";
import {
  createScopedSetupClient,
  runScopedKotaClientOperation,
} from "./scoped-setup-client.js";
import { createScopedWorkflowClient } from "./scoped-workflow-client.js";

function withScope<T extends ScopeSelector>(
  value: T | undefined,
  selector: ScopeSelector,
): T & ScopeSelector {
  return mergeScopeSelector(value, selector);
}

export function createScopedKotaClient(
  base: KotaClient,
  scopeId: string,
): KotaClient {
  return assembleScopedKotaClient(base, { scopeId }, scopeId);
}

function assembleScopedKotaClient(
  base: KotaClient,
  selectorInput: ScopeSelector,
  errorId: string,
): KotaClient {
  const selector = normalizeScopeSelector(selectorInput);
  const selectedId = selectedScopeSelectorId(selector);
  if (!selectedId) {
    throw new KotaClientScopeError(errorId);
  }
  const scoped = runScopedKotaClientOperation;
  const updateTaskBody = base.tasks?.updateBody?.bind(base.tasks);
  return {
    ...base,
    forScope: (nextScopeId) =>
      createScopedKotaClient(base, nextScopeId),
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
      add: (content, tags, scopeSelector) =>
        scoped(selectedId, () =>
          base.memory.add(content, tags, withScope(scopeSelector, selector)),
        ),
      delete: (id, scopeSelector) =>
        scoped(selectedId, () =>
          base.memory.delete(id, withScope(scopeSelector, selector)),
        ),
      search: (query, filter) =>
        scoped(selectedId, () =>
          base.memory.search(query, withScope(filter, selector)),
        ),
      reindex: (scopeSelector) =>
        scoped(selectedId, () =>
          base.memory.reindex(withScope(scopeSelector, selector)),
        ),
    },
    knowledge: {
      list: (filter) =>
        scoped(selectedId, () =>
          base.knowledge.list(withScope(filter, selector)),
        ),
      show: (id, scopeSelector) =>
        scoped(selectedId, () =>
          base.knowledge.show(id, withScope(scopeSelector, selector)),
        ),
      search: (query, filter) =>
        scoped(selectedId, () =>
          base.knowledge.search(query, withScope(filter, selector)),
        ),
      add: (options) =>
        scoped(selectedId, () =>
          base.knowledge.add(withScope(options, selector)),
        ),
      delete: (id, scopeSelector) =>
        scoped(selectedId, () =>
          base.knowledge.delete(id, withScope(scopeSelector, selector)),
        ),
      reindex: (scopeSelector) =>
        scoped(selectedId, () =>
          base.knowledge.reindex(withScope(scopeSelector, selector)),
        ),
    },
    history: {
      list: (filter) =>
        scoped(selectedId, () =>
          base.history.list(withScope(filter, selector)),
        ),
      listDiscoveredScopeRecords: (filter) =>
        base.history.listDiscoveredScopeRecords(filter),
      show: (id, scopeSelector) =>
        scoped(selectedId, () =>
          base.history.show(id, withScope(scopeSelector, selector)),
        ),
      delete: (id, scopeSelector) =>
        scoped(selectedId, () =>
          base.history.delete(id, withScope(scopeSelector, selector)),
        ),
      search: (query, filter) =>
        scoped(selectedId, () =>
          base.history.search(query, withScope(filter, selector)),
        ),
      reindex: (scopeSelector) =>
        scoped(selectedId, () =>
          base.history.reindex(withScope(scopeSelector, selector)),
        ),
    },
    inboundSignals: {
      listRoutes: (scopeSelector) =>
        scoped(selectedId, () =>
          base.inboundSignals.listRoutes(withScope(scopeSelector, selector)),
        ),
      validateRoutes: (scopeSelector) =>
        scoped(selectedId, () =>
          base.inboundSignals.validateRoutes(withScope(scopeSelector, selector)),
        ),
    },
    tasks: {
      list: (states, scopeSelector) =>
        scoped(selectedId, () =>
          base.tasks.list(states, withScope(scopeSelector, selector)),
        ),
      show: (id, scopeSelector) =>
        scoped(selectedId, () =>
          base.tasks.show(id, withScope(scopeSelector, selector)),
        ),
      move: (id, toState, scopeSelector) =>
        scoped(selectedId, () =>
          base.tasks.move(id, toState, withScope(scopeSelector, selector)),
        ),
      ...(updateTaskBody
        ? {
            updateBody: (id, body, scopeSelector) =>
              scoped(selectedId, () =>
                updateTaskBody(id, body, withScope(scopeSelector, selector)),
              ),
          }
        : {}),
      create: (options) =>
        scoped(selectedId, () =>
          base.tasks.create(withScope(options, selector)),
        ),
      capture: (title, scopeSelector) =>
        scoped(selectedId, () =>
          base.tasks.capture(title, withScope(scopeSelector, selector)),
        ),
      search: (query, filter) =>
        scoped(selectedId, () =>
          base.tasks.search(query, withScope(filter, selector)),
        ),
      reindex: (scopeSelector) =>
        scoped(selectedId, () =>
          base.tasks.reindex(withScope(scopeSelector, selector)),
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
      show: (id, scopeSelector) =>
        scoped(selectedId, () =>
          base.answer.show(id, withScope(scopeSelector, selector)),
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
	  approve: (id, reviewDigest, note, scopeSelector) =>
		scoped(selectedId, () =>
		  base.approvals.approve(id, reviewDigest, note, withScope(scopeSelector, selector)),
		),
      reject: (id, reason, scopeSelector) =>
        scoped(selectedId, () =>
          base.approvals.reject(id, reason, withScope(scopeSelector, selector)),
        ),
    },
    secrets: {
      list: (scopeSelector) =>
        scoped(selectedId, () =>
          base.secrets.list(withScope(scopeSelector, selector)),
        ),
      get: (name, scopeSelector) =>
        scoped(selectedId, () =>
          base.secrets.get(name, withScope(scopeSelector, selector)),
        ),
      set: (name, value, scope, scopeSelector) =>
        scoped(selectedId, () =>
          base.secrets.set(name, value, scope, withScope(scopeSelector, selector)),
        ),
      remove: (name, scope, scopeSelector) =>
        scoped(selectedId, () =>
          base.secrets.remove(name, scope, withScope(scopeSelector, selector)),
        ),
    },
    setup: createScopedSetupClient({
      base: base.setup,
      selector,
      selectedId,
    }),
    ownerDecisions: {
      list: (filter) =>
        scoped(selectedId, () =>
          base.ownerDecisions.list(withScope(filter, selector)),
        ),
      show: (id, scopeSelector) =>
        scoped(selectedId, () =>
          base.ownerDecisions.show(id, withScope(scopeSelector, selector)),
        ),
      answer: (id, selectedValue, scopeSelector) =>
        scoped(selectedId, () =>
          base.ownerDecisions.answer(id, selectedValue, withScope(scopeSelector, selector)),
        ),
      cancel: (id, reason, scopeSelector) =>
        scoped(selectedId, () =>
          base.ownerDecisions.cancel(id, reason, withScope(scopeSelector, selector)),
        ),
    },
    ownerQuestions: {
      list: (filter) =>
        scoped(selectedId, () =>
          base.ownerQuestions.list(withScope(filter, selector)),
        ),
      answer: (id, answer, scopeSelector) =>
        scoped(selectedId, () =>
          base.ownerQuestions.answer(id, answer, withScope(scopeSelector, selector)),
        ),
      dismiss: (id, reason, scopeSelector) =>
        scoped(selectedId, () =>
          base.ownerQuestions.dismiss(id, reason, withScope(scopeSelector, selector)),
        ),
    },
  };
}
