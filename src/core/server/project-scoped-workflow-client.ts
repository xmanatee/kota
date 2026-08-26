import type { KotaClient } from "./kota-client.js";
import type { ScopeSelector } from "./scope-selector.js";

type WorkflowClient = KotaClient["workflow"];

type ScopedOperation = <T>(
  selectedId: string,
  operation: () => Promise<T>,
) => Promise<T>;

type ScopeMerger = <T extends ScopeSelector>(
  value: T | undefined,
  selector: ScopeSelector,
) => T & ScopeSelector;

export function createScopedWorkflowClient(input: {
  base: WorkflowClient;
  selector: ScopeSelector;
  selectedId: string;
  scoped: ScopedOperation;
  withScope: ScopeMerger;
}): WorkflowClient {
  const { base, selector, selectedId, scoped, withScope } = input;
  return {
    ...base,
    listDeadLetters: (filter) =>
      scoped(selectedId, () => base.listDeadLetters(withScope(filter, selector))),
    getDeadLetter: (id) =>
      scoped(selectedId, () => base.getDeadLetter(id, selectedId)),
    dismissDeadLetter: (id, reason) =>
      scoped(selectedId, () => base.dismissDeadLetter(id, reason, selectedId)),
    redriveDeadLetter: (id, options) =>
      scoped(selectedId, () => base.redriveDeadLetter(id, options, selectedId)),
    exportDeadLetterDiagnostics: (id) =>
      scoped(selectedId, () => base.exportDeadLetterDiagnostics(id, selectedId)),
    status: (filter) =>
      scoped(selectedId, () => base.status(withScope(filter, selector))),
	getRun: (id) =>
		scoped(selectedId, () => base.getRun(id, selector)),
	listDefinitions: () =>
		scoped(selectedId, () => base.listDefinitions(selector)),
	triggerByName: (name, options) =>
		scoped(
			selectedId,
			() => base.triggerByName(name, withScope(options, selector)),
		),
    trial: (name, options) =>
      scoped(selectedId, () => base.trial(name, withScope(options, selector))),
  };
}
