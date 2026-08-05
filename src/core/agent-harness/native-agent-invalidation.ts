import {
  type ScopePolicyArea,
  type ScopePolicyAuthority,
  type ScopePolicySnapshot,
  scopePolicyRestrictiveAreas,
} from "#core/daemon/scope-policy.js";

export type NativeAgentInvalidationLifecycle = {
  readonly abortController: AbortController;
  dispose(): void;
};

export class NativeAgentScopePolicyRestrictionError extends Error {
  constructor(
    executionLabel: string,
    initialRevision: number,
    currentRevision: number,
    restrictiveAreas: readonly ScopePolicyArea[],
  ) {
    super(
      `${executionLabel} stopped because scope policy became more restrictive ` +
        `(authority revision ${initialRevision} -> ${currentRevision}; ` +
        `areas: ${restrictiveAreas.join(", ")})`,
    );
    this.name = "NativeAgentScopePolicyRestrictionError";
  }
}

/**
 * Owns the abort controller for one native agent launch. Parent cancellation
 * and live authority restrictions converge on that controller so every caller
 * gets the same quarantine trigger and listener cleanup behavior.
 */
export function createNativeAgentInvalidationLifecycle(input: {
  executionLabel: string;
  parentSignal?: AbortSignal;
  scopeId?: string;
  authority?: ScopePolicyAuthority;
  initialSnapshot?: ScopePolicySnapshot;
}): NativeAgentInvalidationLifecycle {
  const abortController = new AbortController();
  const { authority, initialSnapshot, parentSignal, scopeId } = input;
  let disposed = false;
  let unsubscribeAuthority: (() => void) | undefined;

  const forwardParentAbort = (): void => {
    abortController.abort(parentSignal?.reason);
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    parentSignal?.removeEventListener("abort", forwardParentAbort);
    abortController.signal.removeEventListener("abort", dispose);
    const unsubscribe = unsubscribeAuthority;
    unsubscribeAuthority = undefined;
    unsubscribe?.();
  };

  abortController.signal.addEventListener("abort", dispose, { once: true });
  if (parentSignal?.aborted) {
    forwardParentAbort();
  } else {
    parentSignal?.addEventListener("abort", forwardParentAbort, { once: true });
  }

  if (
    !abortController.signal.aborted &&
    authority !== undefined &&
    initialSnapshot !== undefined &&
    scopeId !== undefined
  ) {
    const abortForRestriction = (current: ScopePolicySnapshot): void => {
      if (
        abortController.signal.aborted ||
        current.revision <= initialSnapshot.revision
      ) {
        return;
      }
      const restrictiveAreas = scopePolicyRestrictiveAreas(
        initialSnapshot.policy,
        current.policy,
      );
      if (restrictiveAreas.length === 0) return;
      abortController.abort(
        new NativeAgentScopePolicyRestrictionError(
          input.executionLabel,
          initialSnapshot.revision,
          current.revision,
          restrictiveAreas,
        ),
      );
    };

    try {
      const unsubscribe = authority.subscribeRestrictiveChanges(
        scopeId,
        (change) => abortForRestriction(change.current),
      );
      if (disposed) {
        unsubscribe();
      } else {
        unsubscribeAuthority = unsubscribe;
      }
      // Close the snapshot-to-subscription race without polling. Both authority
      // operations are synchronous, so later restrictive commits reach the listener.
      abortForRestriction(authority.getSnapshot(scopeId));
    } catch (error) {
      dispose();
      throw error;
    }
  }

  return { abortController, dispose };
}
