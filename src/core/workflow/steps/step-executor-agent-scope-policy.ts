import {
  type ScopePolicyAuthority,
  type ScopePolicySnapshot,
  scopePolicyRestrictiveAreas,
} from "#core/daemon/scope-policy.js";

class AgentScopePolicyRestrictionError extends Error {
  constructor(
    stepId: string,
    initialRevision: number,
    currentRevision: number,
    restrictiveAreas: readonly string[],
  ) {
    super(
      `Agent step "${stepId}" stopped because scope policy became more restrictive ` +
        `(authority revision ${initialRevision} -> ${currentRevision}; ` +
        `areas: ${restrictiveAreas.join(", ")})`,
    );
    this.name = "AgentScopePolicyRestrictionError";
  }
}

export function subscribeAgentScopePolicyRestrictions(input: {
  stepId: string;
  scopeId: string | undefined;
  authority: ScopePolicyAuthority | undefined;
  initialSnapshot: ScopePolicySnapshot | undefined;
  abortController: AbortController;
}): () => void {
  const { authority, initialSnapshot, scopeId } = input;
  if (
    authority === undefined ||
    initialSnapshot === undefined ||
    scopeId === undefined ||
    input.abortController.signal.aborted
  ) {
    return () => {};
  }

  const abortForRestriction = (current: ScopePolicySnapshot): void => {
    if (
      input.abortController.signal.aborted ||
      current.revision <= initialSnapshot.revision
    ) {
      return;
    }
    const restrictiveAreas = scopePolicyRestrictiveAreas(
      initialSnapshot.policy,
      current.policy,
    );
    if (restrictiveAreas.length === 0) return;
    input.abortController.abort(
      new AgentScopePolicyRestrictionError(
        input.stepId,
        initialSnapshot.revision,
        current.revision,
        restrictiveAreas,
      ),
    );
  };

  const unsubscribeAuthority = authority.subscribeRestrictiveChanges(
    scopeId,
    (change) => abortForRestriction(change.current),
  );
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    input.abortController.signal.removeEventListener("abort", dispose);
    unsubscribeAuthority();
  };
  input.abortController.signal.addEventListener("abort", dispose, { once: true });
  try {
    // Close the snapshot-to-subscription race without polling. Both authority
    // operations are synchronous, so any later restrictive commit reaches the listener.
    abortForRestriction(authority.getSnapshot(scopeId));
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
