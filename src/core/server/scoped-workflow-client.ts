import type { KotaClient } from "#root/client/kota-client.generated.js";
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
    listRuns: (filter) =>
      scoped(selectedId, () => base.listRuns(withScope(filter, selector))),
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
    pause: (scopeSelector) =>
      scoped(selectedId, () => base.pause(withScope(scopeSelector, selector))),
    pauseAgentForQuality: (reason, scopeSelector) =>
      scoped(selectedId, () =>
        base.pauseAgentForQuality(reason, withScope(scopeSelector, selector))
      ),
    resume: (options, scopeSelector) =>
      scoped(selectedId, () =>
        base.resume(options, withScope(scopeSelector, selector))
      ),
    abort: (scopeSelector) =>
      scoped(selectedId, () => base.abort(withScope(scopeSelector, selector))),
    reload: (scopeSelector) =>
      scoped(selectedId, () => base.reload(withScope(scopeSelector, selector))),
    getRun: (id, scopeSelector) =>
      scoped(selectedId, () =>
        base.getRun(id, withScope(scopeSelector, selector))
      ),
    listDefinitions: (scopeSelector) =>
      scoped(selectedId, () =>
        base.listDefinitions(withScope(scopeSelector, selector))
      ),
    triggerByName: (name, options) =>
      scoped(
        selectedId,
        () => base.triggerByName(name, withScope(options, selector)),
      ),
    trial: (name, options) =>
      scoped(selectedId, () => base.trial(name, withScope(options, selector))),
    enable: (name, scopeSelector) =>
      scoped(selectedId, () =>
        base.enable(name, withScope(scopeSelector, selector))
      ),
    disable: (name, scopeSelector) =>
      scoped(selectedId, () =>
        base.disable(name, withScope(scopeSelector, selector))
      ),
    cancelRun: (id, scopeSelector) =>
      scoped(selectedId, () =>
        base.cancelRun(id, withScope(scopeSelector, selector))
      ),
    abortRun: (id, scopeSelector) =>
      scoped(selectedId, () =>
        base.abortRun(id, withScope(scopeSelector, selector))
      ),
  };
}
