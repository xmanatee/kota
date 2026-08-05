import { describe, expect, it, vi } from "vitest";
import {
  type ResolvedScopePolicy,
  type RestrictiveScopePolicyChangeListener,
  resolveScopePolicy,
  type ScopePolicyAuthority,
  type ScopePolicySnapshot,
  scopePolicyRestrictiveAreas,
} from "#core/daemon/scope-policy.js";
import {
  createNativeAgentInvalidationLifecycle,
  NativeAgentScopePolicyRestrictionError,
} from "./native-agent-invalidation.js";

const SCOPE_ID = "native-invalidation-fixture";

describe("native agent invalidation lifecycle", () => {
  it("starts aborted without registering listeners when the parent already aborted", () => {
    const reason = new Error("parent already stopped");
    const parent = new AbortController();
    parent.abort(reason);
    const addListener = vi.spyOn(parent.signal, "addEventListener");
    const authority = mutableAuthority(snapshot(0, policy("scope-directory")));

    const lifecycle = createNativeAgentInvalidationLifecycle({
      executionLabel: "Native fixture",
      parentSignal: parent.signal,
      scopeId: SCOPE_ID,
      authority,
      initialSnapshot: authority.getSnapshot(SCOPE_ID),
    });

    expect(lifecycle.abortController.signal.aborted).toBe(true);
    expect(lifecycle.abortController.signal.reason).toBe(reason);
    expect(addListener).not.toHaveBeenCalled();
    expect(authority.subscribeCount()).toBe(0);
    expect(authority.listenerCount()).toBe(0);
  });

  it("propagates a later parent abort and cleans both listeners", () => {
    const reason = new Error("parent stopped later");
    const parent = new AbortController();
    const addListener = vi.spyOn(parent.signal, "addEventListener");
    const removeListener = vi.spyOn(parent.signal, "removeEventListener");
    const authority = mutableAuthority(snapshot(0, policy("scope-directory")));
    const lifecycle = createNativeAgentInvalidationLifecycle({
      executionLabel: "Native fixture",
      parentSignal: parent.signal,
      scopeId: SCOPE_ID,
      authority,
      initialSnapshot: authority.getSnapshot(SCOPE_ID),
    });
    const parentAbortListener = addListener.mock.calls[0]?.[1];

    parent.abort(reason);
    lifecycle.dispose();

    expect(lifecycle.abortController.signal.aborted).toBe(true);
    expect(lifecycle.abortController.signal.reason).toBe(reason);
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("abort", parentAbortListener);
    expect(authority.listenerCount()).toBe(0);
    expect(authority.unsubscribeCount()).toBe(1);
  });

  it("ignores stale and less-restrictive policy revisions before aborting on a restriction", () => {
    const initialSnapshot = snapshot(4, policy("scope-directory"));
    const authority = mutableAuthority(initialSnapshot);
    const lifecycle = createNativeAgentInvalidationLifecycle({
      executionLabel: 'Agent step "native"',
      scopeId: SCOPE_ID,
      authority,
      initialSnapshot,
    });

    authority.emit(snapshot(4, policy("none")));
    expect(lifecycle.abortController.signal.aborted).toBe(false);

    authority.emit(snapshot(5, policy("scope-directory")));
    expect(lifecycle.abortController.signal.aborted).toBe(false);

    authority.emit(snapshot(6, policy("unrestricted")));
    expect(lifecycle.abortController.signal.aborted).toBe(false);

    authority.emit(snapshot(7, policy("none")));
    expect(lifecycle.abortController.signal.aborted).toBe(true);
    expect(lifecycle.abortController.signal.reason).toBeInstanceOf(
      NativeAgentScopePolicyRestrictionError,
    );
    expect(lifecycle.abortController.signal.reason).toHaveProperty(
      "message",
      expect.stringMatching(
        /Agent step "native" stopped.*revision 4 -> 7.*areas: writes/,
      ),
    );
    expect(authority.listenerCount()).toBe(0);
  });

  it("disposes parent and authority listeners idempotently after settlement", () => {
    const parent = new AbortController();
    const addListener = vi.spyOn(parent.signal, "addEventListener");
    const removeListener = vi.spyOn(parent.signal, "removeEventListener");
    const initialSnapshot = snapshot(0, policy("scope-directory"));
    const authority = mutableAuthority(initialSnapshot);
    const lifecycle = createNativeAgentInvalidationLifecycle({
      executionLabel: "Native fixture",
      parentSignal: parent.signal,
      scopeId: SCOPE_ID,
      authority,
      initialSnapshot,
    });
    const parentAbortListener = addListener.mock.calls[0]?.[1];

    lifecycle.dispose();
    lifecycle.dispose();
    parent.abort(new Error("too late"));
    authority.emit(snapshot(1, policy("none")));

    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("abort", parentAbortListener);
    expect(authority.unsubscribeCount()).toBe(1);
    expect(authority.listenerCount()).toBe(0);
    expect(lifecycle.abortController.signal.aborted).toBe(false);
  });

  it("cleans both listeners when authority setup fails", () => {
    const parent = new AbortController();
    const addListener = vi.spyOn(parent.signal, "addEventListener");
    const removeListener = vi.spyOn(parent.signal, "removeEventListener");
    const initialSnapshot = snapshot(0, policy("scope-directory"));
    const trackedAuthority = mutableAuthority(initialSnapshot);
    const failingAuthority: ScopePolicyAuthority = {
      getSnapshot: () => {
        throw new Error("authority unavailable");
      },
      subscribeRestrictiveChanges: (scopeId, listener) =>
        trackedAuthority.subscribeRestrictiveChanges(scopeId, listener),
    };

    expect(() =>
      createNativeAgentInvalidationLifecycle({
        executionLabel: "Native fixture",
        parentSignal: parent.signal,
        scopeId: SCOPE_ID,
        authority: failingAuthority,
        initialSnapshot,
      })
    ).toThrow("authority unavailable");
    const parentAbortListener = addListener.mock.calls[0]?.[1];

    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("abort", parentAbortListener);
    expect(trackedAuthority.unsubscribeCount()).toBe(1);
    expect(trackedAuthority.listenerCount()).toBe(0);
  });
});

function snapshot(
  revision: number,
  resolvedPolicy: ResolvedScopePolicy,
): ScopePolicySnapshot {
  return { revision, policy: resolvedPolicy };
}

function policy(
  writes: "none" | "scope-directory" | "unrestricted",
): ResolvedScopePolicy {
  return resolveScopePolicy({
    projection: {
      rootScopeId: "global",
      defaultScopeId: SCOPE_ID,
      scopes: [
        { scopeId: "global", displayName: "Global" },
        {
          scopeId: SCOPE_ID,
          displayName: "Native invalidation fixture",
          parentScopeId: "global",
          directoryRoot: "/tmp/native-invalidation-fixture",
        },
      ],
    },
    scopeId: SCOPE_ID,
    fragments: [{
      scopeId: SCOPE_ID,
      reason: `Fixture uses ${writes} writes.`,
      writes: { mode: writes },
    }],
  });
}

function mutableAuthority(initial: ScopePolicySnapshot): ScopePolicyAuthority & {
  emit(current: ScopePolicySnapshot): void;
  listenerCount(): number;
  subscribeCount(): number;
  unsubscribeCount(): number;
} {
  let currentSnapshot = initial;
  let subscriptions = 0;
  let unsubscriptions = 0;
  const listeners = new Set<RestrictiveScopePolicyChangeListener>();
  return {
    getSnapshot: (scopeId) => {
      if (scopeId !== SCOPE_ID) throw new Error(`Unexpected scope ${scopeId}`);
      return currentSnapshot;
    },
    subscribeRestrictiveChanges: (scopeId, listener) => {
      if (scopeId !== SCOPE_ID) throw new Error(`Unexpected scope ${scopeId}`);
      subscriptions += 1;
      listeners.add(listener);
      return () => {
        unsubscriptions += 1;
        listeners.delete(listener);
      };
    },
    emit: (current) => {
      const previous = currentSnapshot;
      currentSnapshot = current;
      const restrictiveAreas = scopePolicyRestrictiveAreas(
        previous.policy,
        current.policy,
      );
      for (const listener of [...listeners]) {
        listener({ scopeId: SCOPE_ID, previous, current, restrictiveAreas });
      }
    },
    listenerCount: () => listeners.size,
    subscribeCount: () => subscriptions,
    unsubscribeCount: () => unsubscriptions,
  };
}
